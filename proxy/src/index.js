/**
 * EEN OAuth Proxy - Cloudflare Worker
 *
 * This worker handles OAuth authentication with Eagle Eye Networks (EEN) services.
 * It keeps CLIENT_ID and CLIENT_SECRET secure on the server side.
 * Pre-commit hook will remind to deploy when proxy changes are committed.
 *
 * Endpoints:
 *   POST /proxy/getAccessToken     - Exchange authorization code for tokens
 *   POST /proxy/refreshAccessToken - Refresh access token using stored refresh token
 *   POST /proxy/revoke             - Revoke tokens and clear session
 *
 *   GET|HEAD /health              - Health check (public, no auth required)
 *
 *   GET    /admin/version          - Get proxy version and deploy time
 *   GET    /admin/sessionsCount    - Count active sessions
 *   GET    /admin/rateLimitStats   - Get rate limit statistics
 *   DELETE /admin/removeSessions   - Remove all sessions except current
 *   POST   /admin/revokeAll        - Revoke all tokens (emergency)
 *
 * Rate Limiting:
 *   Configurable via environment variables:
 *   - RATE_LIMIT_ENABLED: 'true' to enable (default: true)
 *   - RATE_LIMIT_HEALTH: requests/minute for /health (default: 60)
 *   - RATE_LIMIT_OAUTH: requests/minute for /proxy/* (default: 30)
 *   - RATE_LIMIT_ADMIN: requests/minute for /admin/* (default: 60)
 *   - RATE_LIMIT_WINDOW: time window in seconds (default: 60)
 */

// EEN OAuth endpoints
const EEN_TOKEN_URL = 'https://auth.eagleeyenetworks.com/oauth2/token'
const EEN_REVOKE_URL = 'https://auth.eagleeyenetworks.com/oauth2/revoke'

// TTL bounds (in seconds)
const MIN_REFRESH_TOKEN_TTL = 0
const MAX_REFRESH_TOKEN_TTL = 2592000 // 30 days
const DEFAULT_REFRESH_TOKEN_TTL = 86400 // 1 day

// Rate limiting defaults
const DEFAULT_RATE_LIMIT_HEALTH = 60 // requests per window
const DEFAULT_RATE_LIMIT_OAUTH = 30 // requests per window
const DEFAULT_RATE_LIMIT_ADMIN = 60 // requests per window
const DEFAULT_RATE_LIMIT_WINDOW = 60 // seconds
const DEFAULT_RATE_LIMIT_UNKNOWN = 5 // very restrictive limit for unidentified clients

// Rate limit categories
const RATE_LIMIT_CATEGORY = {
  HEALTH: 'health',
  OAUTH: 'oauth',
  ADMIN: 'admin'
}

/**
 * Conditional debug logging - only logs in development environment
 * Prevents sensitive information leakage in production
 * @param {Object} env - Environment bindings
 * @param {...any} args - Arguments to log
 */
function debugLog(env, ...args) {
  if (env.ENVIRONMENT === 'development') {
    console.log(...args)
  }
}

/**
 * Conditional error logging - only logs in development environment
 * Prevents sensitive information leakage in production
 * @param {Object} env - Environment bindings
 * @param {...any} args - Arguments to log
 */
function debugError(env, ...args) {
  if (env.ENVIRONMENT === 'development') {
    console.error(...args)
  }
}

/**
 * Get validated refresh token TTL from environment
 * @param {Object} env - Environment bindings
 * @returns {number} - TTL in seconds (bounded between 0 and 30 days)
 */
function getRefreshTokenTtl(env) {
  const parsed = parseInt(env.REFRESH_TOKEN_TTL, 10)
  if (isNaN(parsed)) return DEFAULT_REFRESH_TOKEN_TTL
  return Math.max(MIN_REFRESH_TOKEN_TTL, Math.min(parsed, MAX_REFRESH_TOKEN_TTL))
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')

    // Validate origin
    const corsResult = validateOrigin(origin, env)
    if (!corsResult.valid) {
      return new Response('Forbidden: Invalid origin', { status: 403 })
    }

    // CSRF protection: Require Origin header for state-changing requests
    // Requests without Origin (e.g., curl) are blocked for POST/DELETE to prevent CSRF
    if ((request.method === 'POST' || request.method === 'DELETE') && !origin) {
      return new Response('Forbidden: Origin header required', { status: 403 })
    }

    // Rate limiting check - applies to all requests including OPTIONS preflight
    // This prevents attackers from using OPTIONS floods to probe the server
    const rateLimitResult = await checkRateLimit(request, url, env)
    if (rateLimitResult.limited) {
      const response = jsonResponse(
        {
          error: 'rate_limit_exceeded',
          message: `Too many requests. Please retry after ${rateLimitResult.retryAfter} seconds.`,
          retryAfter: rateLimitResult.retryAfter
        },
        429
      )
      response.headers.set('Retry-After', String(rateLimitResult.retryAfter))
      return addCorsHeaders(response, corsResult.origin, env)
    }

    // Handle CORS preflight (after rate limit check)
    if (request.method === 'OPTIONS') {
      // Increment rate limit counter for OPTIONS requests too
      ctx.waitUntil(incrementRateLimitCounter(request, url, env))
      return handleCorsPreflightRequest(corsResult.origin, env)
    }

    try {
      // Route requests
      const response = await routeRequest(url, request, env)

      // Increment rate limit counter for all requests including 404s
      // This prevents endpoint enumeration attacks where attackers probe for valid paths
      ctx.waitUntil(incrementRateLimitCounter(request, url, env))

      return addCorsHeaders(response, corsResult.origin, env)
    } catch (error) {
      debugError(env, 'Request error:', error)
      // Never expose internal error details to clients - use generic message
      const errorResponse = new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(errorResponse, corsResult.origin, env)
    }
  }
}

/**
 * Route incoming requests to appropriate handlers
 */
async function routeRequest(url, request, env) {
  const path = url.pathname

  // OAuth endpoints
  if (path === '/proxy/getAccessToken' && request.method === 'POST') {
    return handleGetAccessToken(url, request, env)
  }
  if (path === '/proxy/refreshAccessToken' && request.method === 'POST') {
    return handleRefreshAccessToken(request, env)
  }
  if (path === '/proxy/revoke' && request.method === 'POST') {
    return handleRevoke(request, env)
  }

  // Admin endpoints
  if (path === '/admin/version' && request.method === 'GET') {
    return handleAdminVersion(request, env)
  }
  if (path === '/admin/sessionsCount' && request.method === 'GET') {
    return handleAdminSessionsCount(request, env)
  }
  if (path === '/admin/rateLimitStats' && request.method === 'GET') {
    return handleAdminRateLimitStats(request, env)
  }
  if (path === '/admin/removeSessions' && request.method === 'DELETE') {
    return handleAdminRemoveSessions(request, env)
  }
  if (path === '/admin/revokeAll' && request.method === 'POST') {
    return handleAdminRevokeAll(request, env)
  }

  // Health check (public endpoint, no auth required)
  // Accept both GET and HEAD (for monitoring services like UptimeRobot)
  if (path === '/health' && (request.method === 'GET' || request.method === 'HEAD')) {
    return handleHealth(env)
  }

  return new Response('Not Found', { status: 404 })
}

// ============================================================================
// OAuth Endpoint Handlers
// ============================================================================

/**
 * Exchange authorization code for access token
 * POST /proxy/getAccessToken?code=xxx&redirect_uri=xxx
 */
async function handleGetAccessToken(url, request, env) {
  const code = url.searchParams.get('code')
  const redirectUri = url.searchParams.get('redirect_uri')

  if (!code || !redirectUri) {
    return jsonResponse({ error: 'Missing code or redirect_uri' }, 400)
  }

  // Validate code parameter (prevent injection and DoS via large payloads)
  if (code.length > 2000) {
    return jsonResponse({ error: 'Invalid code: too long' }, 400)
  }

  // Validate redirect_uri length (prevent DoS via large payloads)
  if (redirectUri.length > 2000) {
    return jsonResponse({ error: 'Invalid redirect_uri: too long' }, 400)
  }

  // Validate redirect_uri domain against allowed origins (prevent open redirect attacks)
  const redirectValidation = validateRedirectUri(redirectUri, env)
  if (!redirectValidation.valid) {
    return jsonResponse({ error: redirectValidation.error }, 400)
  }

  // Exchange code for tokens with EEN
  const tokenResponse = await fetch(EEN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`)}`
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      scope: 'vms.all',
      redirect_uri: redirectUri
    })
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    debugError(env, 'EEN token error:', errorText)
    return jsonResponse({ error: 'Token exchange failed' }, tokenResponse.status)
  }

  const tokens = await tokenResponse.json()

  // Fetch user profile to get email for admin verification
  // Use the httpsBaseUrl from token response (regional endpoint)
  // httpsBaseUrl can be a string URL or an object {hostname, port}
  let userEmail = null
  try {
    let baseUrl = 'https://api.eagleeyenetworks.com'
    if (tokens.httpsBaseUrl) {
      if (typeof tokens.httpsBaseUrl === 'string') {
        baseUrl = tokens.httpsBaseUrl
      } else if (typeof tokens.httpsBaseUrl === 'object') {
        // Handle object format: {hostname: "c001.eagleeyenetworks.com", port: 443}
        const host = tokens.httpsBaseUrl.hostname || tokens.httpsBaseUrl.host
        const port = tokens.httpsBaseUrl.port
        // Validate host before constructing URL
        if (host && typeof host === 'string') {
          baseUrl = `https://${host}${port && port !== 443 ? ':' + port : ''}`
        }
      }
    }
    debugLog(env, 'Fetching user profile from:', `${baseUrl}/api/v3.0/users/self`)
    const userResponse = await fetch(`${baseUrl}/api/v3.0/users/self`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json'
      }
    })
    debugLog(env, 'User profile response status:', userResponse.status)
    if (userResponse.ok) {
      const userData = await userResponse.json()
      debugLog(env, 'User data received')
      userEmail = userData.email
    } else {
      const errorText = await userResponse.text()
      debugError(env, 'User profile fetch failed:', userResponse.status, errorText)
    }
  } catch (e) {
    debugError(env, 'Failed to fetch user email:', e)
  }

  // Generate session ID and store refresh token
  const sessionId = crypto.randomUUID()
  const sessionData = {
    refreshToken: tokens.refresh_token,
    userEmail: userEmail,
    createdAt: Date.now()
  }

  // Store in KV with TTL matching token expiry (plus configurable buffer for refresh)
  const refreshTokenTtl = getRefreshTokenTtl(env)
  const ttl = (tokens.expires_in || 3600) + refreshTokenTtl
  await env.EEN_OAUTH_SESSIONS.put(sessionId, JSON.stringify(sessionData), {
    expirationTtl: ttl
  })

  // Build response
  const responseData = {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    httpsBaseUrl: tokens.httpsBaseUrl,
    userEmail: userEmail  // Include email so frontend knows who's logged in
  }

  const response = jsonResponse(responseData)

  // Set session cookie
  response.headers.append(
    'Set-Cookie',
    `sessionId=${sessionId}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${ttl}`
  )

  return response
}

/**
 * Refresh access token using stored refresh token
 * POST /proxy/refreshAccessToken
 */
async function handleRefreshAccessToken(request, env) {
  const sessionId = getSessionIdFromCookie(request, env)
  if (!sessionId) {
    return jsonResponse({ error: 'No session found' }, 401)
  }

  // Get stored session data
  const sessionDataStr = await env.EEN_OAUTH_SESSIONS.get(sessionId)
  if (!sessionDataStr) {
    return jsonResponse({ error: 'Session expired or invalid' }, 401)
  }

  const sessionData = JSON.parse(sessionDataStr)

  // Refresh token with EEN
  const tokenResponse = await fetch(EEN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`)}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: sessionData.refreshToken
    })
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    debugError(env, 'EEN refresh error:', errorText)
    // Clear invalid session
    await env.EEN_OAUTH_SESSIONS.delete(sessionId)
    return jsonResponse({ error: 'Token refresh failed' }, tokenResponse.status)
  }

  const tokens = await tokenResponse.json()

  // Update stored refresh token (may have rotated)
  const updatedSessionData = {
    ...sessionData,
    refreshToken: tokens.refresh_token || sessionData.refreshToken
  }

  const refreshTokenTtl = getRefreshTokenTtl(env)
  const ttl = (tokens.expires_in || 3600) + refreshTokenTtl
  await env.EEN_OAUTH_SESSIONS.put(sessionId, JSON.stringify(updatedSessionData), {
    expirationTtl: ttl
  })

  return jsonResponse({
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in
  })
}

/**
 * Revoke tokens and clear session
 * POST /proxy/revoke
 */
async function handleRevoke(request, env) {
  const sessionId = getSessionIdFromCookie(request, env)
  if (!sessionId) {
    return jsonResponse({ error: 'No session found' }, 401)
  }

  // Get stored session data
  const sessionDataStr = await env.EEN_OAUTH_SESSIONS.get(sessionId)
  if (sessionDataStr) {
    const sessionData = JSON.parse(sessionDataStr)

    // Revoke token at EEN
    try {
      await fetch(EEN_REVOKE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`)}`
        },
        body: new URLSearchParams({
          token: sessionData.refreshToken
        })
      })
    } catch (e) {
      debugError(env, 'Failed to revoke token at EEN:', e)
    }

    // Delete session from KV
    await env.EEN_OAUTH_SESSIONS.delete(sessionId)
  }

  // Clear session cookie
  const response = jsonResponse({ message: 'Token revoked successfully' })
  response.headers.append(
    'Set-Cookie',
    'sessionId=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0'
  )

  return response
}

// ============================================================================
// Health Check Handler
// ============================================================================

/**
 * Health check endpoint (public, no auth required)
 * GET /health
 */
async function handleHealth(env) {
  // Get version from KV if available, otherwise return package version
  let version = 'unknown'
  try {
    const deployVersion = await env.EEN_OAUTH_SESSIONS.get('DEPLOY_VERSION')
    if (deployVersion) {
      version = deployVersion
    }
  } catch (e) {
    // KV might not be available in some contexts
    debugError(env, 'Failed to get version from KV:', e)
  }

  return jsonResponse({
    status: 'ok',
    version: version,
    timestamp: new Date().toISOString()
  })
}

// ============================================================================
// Admin Endpoint Handlers
// ============================================================================

/**
 * Get proxy version
 * GET /admin/version
 */
async function handleAdminVersion(request, env) {
  // Require authenticated session
  const sessionId = getSessionIdFromCookie(request, env)
  if (!sessionId) {
    return jsonResponse({ error: 'Authentication required' }, 401)
  }

  const sessionDataStr = await env.EEN_OAUTH_SESSIONS.get(sessionId)
  if (!sessionDataStr) {
    return jsonResponse({ error: 'Session expired or invalid' }, 401)
  }

  // Check if user is admin
  const sessionData = JSON.parse(sessionDataStr)
  if (!isAdminUser(sessionData.userEmail, env)) {
    return jsonResponse({ error: 'Admin access required' }, 403)
  }

  const version = await env.EEN_OAUTH_SESSIONS.get('DEPLOY_VERSION')
  return jsonResponse({
    version: version || 'unknown'
  })
}

/**
 * Get count of active sessions
 * GET /admin/sessionsCount
 */
async function handleAdminSessionsCount(request, env) {
  // Require authenticated admin session
  const adminCheck = await checkAdminAccess(request, env)
  if (adminCheck.error) {
    return jsonResponse({ error: adminCheck.error }, adminCheck.status)
  }

  const listResult = await env.EEN_OAUTH_SESSIONS.list()

  // Filter out special keys (DEPLOY_* and RATE_LIMIT:*)
  const sessionKeys = listResult.keys.filter(
    key => !key.name.startsWith('DEPLOY_') && !key.name.startsWith('RATE_LIMIT:')
  )

  return jsonResponse({
    sessionCount: sessionKeys.length
  })
}

/**
 * Remove all sessions except current
 * DELETE /admin/removeSessions
 */
async function handleAdminRemoveSessions(request, env) {
  // Require authenticated admin session
  const adminCheck = await checkAdminAccess(request, env)
  if (adminCheck.error) {
    return jsonResponse({ error: adminCheck.error }, adminCheck.status)
  }

  const currentSessionId = getSessionIdFromCookie(request, env)
  const listResult = await env.EEN_OAUTH_SESSIONS.list()

  let deletedCount = 0
  for (const key of listResult.keys) {
    // Skip current session and special keys (DEPLOY_* and RATE_LIMIT:*)
    if (
      key.name === currentSessionId ||
      key.name.startsWith('DEPLOY_') ||
      key.name.startsWith('RATE_LIMIT:')
    ) {
      continue
    }

    await env.EEN_OAUTH_SESSIONS.delete(key.name)
    deletedCount++
  }

  return jsonResponse({
    message: 'Sessions removed successfully',
    deletedSessions: deletedCount,
    remainingSessions: 1
  })
}

/**
 * Revoke all tokens (emergency)
 * POST /admin/revokeAll
 */
async function handleAdminRevokeAll(request, env) {
  // Require authenticated admin session
  const adminCheck = await checkAdminAccess(request, env)
  if (adminCheck.error) {
    return jsonResponse({ error: adminCheck.error }, adminCheck.status)
  }

  const currentSessionId = getSessionIdFromCookie(request, env)
  const listResult = await env.EEN_OAUTH_SESSIONS.list()

  let revokedCount = 0
  let errorCount = 0

  for (const key of listResult.keys) {
    // Skip special keys (DEPLOY_* and RATE_LIMIT:*)
    if (key.name.startsWith('DEPLOY_') || key.name.startsWith('RATE_LIMIT:')) {
      continue
    }

    try {
      const sessionDataStr = await env.EEN_OAUTH_SESSIONS.get(key.name)
      if (sessionDataStr) {
        const sessionData = JSON.parse(sessionDataStr)

        // Revoke token at EEN
        await fetch(EEN_REVOKE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`)}`
          },
          body: new URLSearchParams({
            token: sessionData.refreshToken
          })
        })

        revokedCount++
      }

      // Delete session from KV
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    } catch (e) {
      debugError(env, `Failed to revoke session ${key.name}:`, e)
      errorCount++
    }
  }

  // Clear current session cookie
  const response = jsonResponse({
    message: 'All tokens revoked',
    revokedSessions: revokedCount,
    errors: errorCount
  })

  response.headers.append(
    'Set-Cookie',
    'sessionId=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0'
  )

  return response
}

// ============================================================================
// Rate Limiting Functions
// ============================================================================

/**
 * Get rate limit configuration from environment
 * @param {Object} env - Environment bindings
 * @returns {Object} Rate limit configuration
 */
function getRateLimitConfig(env) {
  const enabled = env.RATE_LIMIT_ENABLED !== 'false' // Default: enabled
  const window = parseInt(env.RATE_LIMIT_WINDOW, 10) || DEFAULT_RATE_LIMIT_WINDOW

  return {
    enabled,
    window,
    limits: {
      [RATE_LIMIT_CATEGORY.HEALTH]: parseInt(env.RATE_LIMIT_HEALTH, 10) || DEFAULT_RATE_LIMIT_HEALTH,
      [RATE_LIMIT_CATEGORY.OAUTH]: parseInt(env.RATE_LIMIT_OAUTH, 10) || DEFAULT_RATE_LIMIT_OAUTH,
      [RATE_LIMIT_CATEGORY.ADMIN]: parseInt(env.RATE_LIMIT_ADMIN, 10) || DEFAULT_RATE_LIMIT_ADMIN
    },
    // Very restrictive limit for unidentified clients (no CF-Connecting-IP or session)
    unknownLimit: parseInt(env.RATE_LIMIT_UNKNOWN, 10) || DEFAULT_RATE_LIMIT_UNKNOWN
  }
}

/**
 * Determine rate limit category from URL path
 * @param {string} path - Request path
 * @returns {string|null} Rate limit category or null if not rate limited
 */
function getRateLimitCategory(path) {
  if (path === '/health') {
    return RATE_LIMIT_CATEGORY.HEALTH
  }
  if (path.startsWith('/proxy/')) {
    return RATE_LIMIT_CATEGORY.OAUTH
  }
  if (path.startsWith('/admin/')) {
    return RATE_LIMIT_CATEGORY.ADMIN
  }
  return null
}

/**
 * Get client identifier for rate limiting
 * Uses CF-Connecting-IP header (Cloudflare provides real client IP)
 * Falls back to session ID for authenticated requests
 * In production (Cloudflare), CF-Connecting-IP should always be present
 * @param {Request} request - Incoming request
 * @param {Object} env - Environment bindings
 * @returns {{identifier: string, isUnknown: boolean}} Client identifier and unknown flag
 */
function getClientIdentifier(request, env) {
  // Prefer CF-Connecting-IP (real client IP from Cloudflare)
  // This should ALWAYS be present on Cloudflare Workers in production
  const cfIp = request.headers.get('CF-Connecting-IP')
  if (cfIp) {
    return { identifier: `ip|${cfIp}`, isUnknown: false }
  }

  // In production, missing CF-Connecting-IP is suspicious - log warning
  // X-Forwarded-For can be spoofed by clients, so treat as unknown in production
  // Note: undefined ENVIRONMENT is treated as development (local wrangler dev)
  const isProduction = env.ENVIRONMENT === 'production'
  if (isProduction) {
    // Log warning in production (not using debugError which is dev-only)
    console.warn('Rate limit: CF-Connecting-IP missing in production, using restrictive limit')
  }

  // Fall back to X-Forwarded-For in development (it's spoofable in production)
  // This includes local dev where ENVIRONMENT may be undefined
  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (forwardedFor && !isProduction) {
    // Take the first IP (original client) - only trusted in development
    const clientIp = forwardedFor.split(',')[0].trim()
    return { identifier: `ip|${clientIp}`, isUnknown: false }
  }

  // Fall back to session ID if available
  const sessionId = getSessionIdFromCookie(request, env)
  if (sessionId) {
    return { identifier: `session|${sessionId}`, isUnknown: false }
  }

  // Last resort: use a restrictive shared bucket for unidentified clients
  // In production, this catches requests without CF-Connecting-IP (non-Cloudflare paths)
  // In development, this catches requests without X-Forwarded-For
  return { identifier: 'unknown', isUnknown: true }
}

/**
 * Get rate limit key for KV storage
 * @param {string} category - Rate limit category
 * @param {string} identifier - Client identifier
 * @param {number} window - Time window in seconds
 * @returns {string} KV key
 */
function getRateLimitKey(category, identifier, window) {
  // Use minute bucket for time-based windowing
  const bucket = Math.floor(Date.now() / (window * 1000))
  return `RATE_LIMIT:${category}:${identifier}:${bucket}`
}

/**
 * Check if request is rate limited
 * Note: Counter increments are non-atomic due to KV's eventual consistency.
 * This means under high concurrency, some requests may slip through slightly
 * over the limit. This is acceptable for rate limiting purposes - the goal
 * is protection against abuse, not precise counting.
 * @param {Request} request - Incoming request
 * @param {URL} url - Parsed URL
 * @param {Object} env - Environment bindings
 * @returns {Promise<{limited: boolean, retryAfter?: number}>}
 */
async function checkRateLimit(request, url, env) {
  const config = getRateLimitConfig(env)

  // Skip if rate limiting is disabled
  if (!config.enabled) {
    return { limited: false }
  }

  const category = getRateLimitCategory(url.pathname)

  // Skip if path is not rate limited (e.g., 404 paths)
  if (!category) {
    return { limited: false }
  }

  const { identifier, isUnknown } = getClientIdentifier(request, env)

  // Use restrictive limit for unidentified clients (no CF-Connecting-IP or session)
  // This prevents abuse from clients that bypass normal identification
  const limit = isUnknown ? config.unknownLimit : config.limits[category]

  // Skip if limit is 0 (disabled for this category)
  if (limit === 0) {
    return { limited: false }
  }

  const key = getRateLimitKey(category, identifier, config.window)

  try {
    const countStr = await env.EEN_OAUTH_SESSIONS.get(key)
    const count = countStr ? parseInt(countStr, 10) : 0

    if (count >= limit) {
      // Calculate retry-after based on window
      const bucket = Math.floor(Date.now() / (config.window * 1000))
      const nextBucketStart = (bucket + 1) * config.window * 1000
      const retryAfter = Math.ceil((nextBucketStart - Date.now()) / 1000)

      return { limited: true, retryAfter: Math.max(1, retryAfter) }
    }
  } catch (e) {
    // If KV fails, allow the request (fail open)
    debugError(env, 'Rate limit check failed:', e)
  }

  return { limited: false }
}

/**
 * Increment rate limit counter for a request
 * @param {Request} request - Incoming request
 * @param {URL} url - Parsed URL
 * @param {Object} env - Environment bindings
 */
async function incrementRateLimitCounter(request, url, env) {
  const config = getRateLimitConfig(env)

  // Skip if rate limiting is disabled
  if (!config.enabled) {
    return
  }

  const category = getRateLimitCategory(url.pathname)

  // Skip if path is not rate limited
  if (!category) {
    return
  }

  const { identifier } = getClientIdentifier(request, env)
  const key = getRateLimitKey(category, identifier, config.window)

  try {
    const countStr = await env.EEN_OAUTH_SESSIONS.get(key)
    const count = countStr ? parseInt(countStr, 10) : 0

    // Store with TTL of 2x window to ensure cleanup
    await env.EEN_OAUTH_SESSIONS.put(key, String(count + 1), {
      expirationTtl: config.window * 2
    })
  } catch (e) {
    // If KV fails, just log and continue
    debugError(env, 'Rate limit increment failed:', e)
  }
}

/**
 * Get rate limit statistics for admin endpoint
 * GET /admin/rateLimitStats
 */
async function handleAdminRateLimitStats(request, env) {
  // Require authenticated admin session
  const adminCheck = await checkAdminAccess(request, env)
  if (adminCheck.error) {
    return jsonResponse({ error: adminCheck.error }, adminCheck.status)
  }

  const config = getRateLimitConfig(env)

  // Get current rate limit entries from KV
  const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:' })

  // Parse and aggregate stats
  const stats = {
    enabled: config.enabled,
    window: config.window,
    limits: config.limits,
    currentBucket: Math.floor(Date.now() / (config.window * 1000)),
    activeEntries: listResult.keys.length,
    byCategory: {
      [RATE_LIMIT_CATEGORY.HEALTH]: { count: 0, uniqueClients: 0 },
      [RATE_LIMIT_CATEGORY.OAUTH]: { count: 0, uniqueClients: 0 },
      [RATE_LIMIT_CATEGORY.ADMIN]: { count: 0, uniqueClients: 0 }
    }
  }

  // Aggregate counts by category
  const clientsByCategory = {
    [RATE_LIMIT_CATEGORY.HEALTH]: new Set(),
    [RATE_LIMIT_CATEGORY.OAUTH]: new Set(),
    [RATE_LIMIT_CATEGORY.ADMIN]: new Set()
  }

  for (const key of listResult.keys) {
    // Parse key format: RATE_LIMIT:{category}:{identifier}:{bucket}
    const parts = key.name.split(':')
    if (parts.length >= 4) {
      const category = parts[1]
      const identifier = parts.slice(2, -1).join(':') // Handle identifiers with colons

      if (stats.byCategory[category]) {
        clientsByCategory[category].add(identifier)
      }
    }
  }

  // Fetch actual counts for current entries
  for (const key of listResult.keys) {
    try {
      const countStr = await env.EEN_OAUTH_SESSIONS.get(key.name)
      const count = countStr ? parseInt(countStr, 10) : 0
      const parts = key.name.split(':')
      if (parts.length >= 4) {
        const category = parts[1]
        if (stats.byCategory[category]) {
          stats.byCategory[category].count += count
        }
      }
    } catch (e) {
      // Log error but continue processing other keys
      debugError(env, 'Failed to fetch rate limit stat:', key.name, e.message)
    }
  }

  // Set unique client counts
  for (const category of Object.keys(clientsByCategory)) {
    stats.byCategory[category].uniqueClients = clientsByCategory[category].size
  }

  return jsonResponse(stats)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get list of allowed origins from environment
 */
function getAllowedOrigins(env) {
  const allowedOriginsStr = env.ALLOWED_ORIGINS || ''
  const allowedOrigins = allowedOriginsStr
    .split(',')
    .map(o => o.trim())
    .filter(o => o.length > 0)

  // In development, also allow 127.0.0.1:3333 (EEN redirect URI)
  // Note: We intentionally do NOT allow localhost:3333 because EEN OAuth
  // requires exact redirect URI match. Since EEN is configured for
  // http://127.0.0.1:3333, using localhost would fail OAuth callbacks
  // even though localhost and 127.0.0.1 resolve to the same address.
  if (env.ENVIRONMENT === 'development') {
    allowedOrigins.push('http://127.0.0.1:3333')
  }

  return allowedOrigins
}

/**
 * Validate redirect_uri against allowed origins (prevent open redirect attacks)
 * The redirect_uri's origin must match one of the allowed origins
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateRedirectUri(redirectUri, env) {
  let url
  try {
    url = new URL(redirectUri)
  } catch (e) {
    // Invalid URL format
    return { valid: false, error: 'Invalid redirect_uri: malformed URL' }
  }

  const redirectOrigin = url.origin
  const allowedOrigins = getAllowedOrigins(env)

  if (!allowedOrigins.includes(redirectOrigin)) {
    // Check if this is a localhost vs 127.0.0.1 mismatch - provide helpful error
    if (redirectOrigin.includes('localhost') &&
        allowedOrigins.some(o => o.includes('127.0.0.1'))) {
      return {
        valid: false,
        error: 'Invalid redirect_uri: use 127.0.0.1 instead of localhost (EEN requires exact match)'
      }
    }
    return { valid: false, error: 'Invalid redirect_uri: domain not allowed' }
  }

  return { valid: true }
}

/**
 * Validate request origin against allowed origins
 */
function validateOrigin(origin, env) {
  if (!origin) {
    // Allow requests without origin (e.g., from tools like curl)
    return { valid: true, origin: '*' }
  }

  const allowedOrigins = getAllowedOrigins(env)

  if (allowedOrigins.includes(origin)) {
    // In production, enforce HTTPS (except for local testing if allowed)
    if (env.ENVIRONMENT === 'production' && !origin.startsWith('https://')) {
      // Allow localhost/127.0.0.1 even in production as it is a secure context
      const isLocalhost = origin.includes('://localhost') || origin.includes('://127.0.0.1') || origin.includes('://[::1]')
      if (!isLocalhost) {
        return { valid: false, origin: null }
      }
    }
    return { valid: true, origin }
  }

  return { valid: false, origin: null }
}

/**
 * Handle CORS preflight requests
 */
function handleCorsPreflightRequest(origin, env) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin, env)
  })
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response, origin, env) {
  const newHeaders = new Headers(response.headers)
  const corsHeaders = getCorsHeaders(origin, env)

  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  })
}

/**
 * Get CORS and security headers
 * @param {string} origin - The request origin
 * @param {Object} env - Environment bindings (optional, for conditional headers)
 */
function getCorsHeaders(origin, env = null) {
  const headers = {
    // CORS headers
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
    'Access-Control-Max-Age': '86400',
    // Security headers
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  }

  // Credentials can only be true if Origin is NOT '*'
  if (origin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }

  // Only add HSTS in production (can cause issues with localhost in development)
  if (!env || env.ENVIRONMENT !== 'development') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  }

  return headers
}

/**
 * Extract session ID from cookie header
 * Returns null for missing or invalid session IDs
 */
// Session ID format: alphanumeric, hyphens, underscores only (prevents injection)
// Minimum 20 characters to prevent brute force attacks (UUIDs are 36 chars)
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{20,50}$/

function getSessionIdFromCookie(request, env) {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map(c => c.trim())
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split('=')
    const value = valueParts.join('=')
    if (name === 'sessionId') {
      // Validate session ID format (alphanumeric + hyphens/underscores only)
      if (!value || !SESSION_ID_REGEX.test(value)) {
        // Use conditional logging to prevent info leakage in production
        debugLog(env, 'Invalid session ID format')
        return null
      }
      return value
    }
  }

  return null
}

/**
 * Check if user email is in admin list
 */
function isAdminUser(userEmail, env) {
  if (!userEmail) return false

  const adminEmailsStr = env.ADMIN_EMAILS || ''
  const adminEmails = adminEmailsStr
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 0)

  return adminEmails.includes(userEmail.toLowerCase())
}

/**
 * Check admin access for a request
 * If userEmail is missing, attempts to fetch it from EEN API
 */
async function checkAdminAccess(request, env) {
  const sessionId = getSessionIdFromCookie(request, env)
  if (!sessionId) {
    return { error: 'Authentication required', status: 401 }
  }

  const sessionDataStr = await env.EEN_OAUTH_SESSIONS.get(sessionId)
  if (!sessionDataStr) {
    return { error: 'Session expired or invalid', status: 401 }
  }

  let sessionData = JSON.parse(sessionDataStr)

  // If userEmail is missing, try to fetch it from EEN
  if (!sessionData.userEmail && sessionData.refreshToken) {
    debugLog(env, 'userEmail missing, fetching from EEN...')
    try {
      // First refresh to get access token and baseUrl
      const tokenResponse = await fetch(EEN_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`)}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: sessionData.refreshToken
        })
      })

      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json()

        // Parse httpsBaseUrl - can be string or object {hostname, port}
        let baseUrl = 'https://api.eagleeyenetworks.com'
        if (tokens.httpsBaseUrl) {
          if (typeof tokens.httpsBaseUrl === 'string') {
            baseUrl = tokens.httpsBaseUrl
          } else if (typeof tokens.httpsBaseUrl === 'object') {
            const host = tokens.httpsBaseUrl.hostname || tokens.httpsBaseUrl.host
            const port = tokens.httpsBaseUrl.port
            // Validate host before constructing URL
            if (host && typeof host === 'string') {
              baseUrl = `https://${host}${port && port !== 443 ? ':' + port : ''}`
            }
          }
        }
        debugLog(env, 'On-demand fetch: using baseUrl:', baseUrl)

        // Fetch user profile
        const userResponse = await fetch(`${baseUrl}/api/v3.0/users/self`, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/json'
          }
        })

        if (userResponse.ok) {
          const userData = await userResponse.json()
          debugLog(env, 'Fetched user email on-demand')

          // Re-read session to reduce race condition window
          // Another request might have already updated the email
          const currentSessionStr = await env.EEN_OAUTH_SESSIONS.get(sessionId)
          if (currentSessionStr) {
            const currentSession = JSON.parse(currentSessionStr)
            // Only update if email is still missing (reduce duplicate writes)
            if (!currentSession.userEmail) {
              currentSession.userEmail = userData.email
              currentSession.refreshToken = tokens.refresh_token || currentSession.refreshToken
              const refreshTokenTtl = getRefreshTokenTtl(env)
              const ttl = (tokens.expires_in || 3600) + refreshTokenTtl
              await env.EEN_OAUTH_SESSIONS.put(sessionId, JSON.stringify(currentSession), {
                expirationTtl: ttl
              })
              sessionData = currentSession // Update local reference
            } else {
              sessionData.userEmail = currentSession.userEmail
            }
          }
        }
      }
    } catch (e) {
      debugError(env, 'Failed to fetch user email on-demand:', e)
    }
  }

  if (!isAdminUser(sessionData.userEmail, env)) {
    return { error: 'Admin access required', status: 403 }
  }

  return { sessionId, sessionData }
}

/**
 * Create JSON response
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
