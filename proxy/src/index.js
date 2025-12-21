/**
 * EEN OAuth Proxy - Cloudflare Worker
 *
 * This worker handles OAuth authentication with Eagle Eye Networks (EEN) services.
 * It keeps CLIENT_ID and CLIENT_SECRET secure on the server side.
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
 *   DELETE /admin/removeSessions   - Remove all sessions except current
 *   POST   /admin/revokeAll        - Revoke all tokens (emergency)
 */

// EEN OAuth endpoints
const EEN_TOKEN_URL = 'https://auth.eagleeyenetworks.com/oauth2/token'
const EEN_REVOKE_URL = 'https://auth.eagleeyenetworks.com/oauth2/revoke'

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

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCorsPreflightRequest(corsResult.origin)
    }

    try {
      // Route requests
      const response = await routeRequest(url, request, env)
      return addCorsHeaders(response, corsResult.origin)
    } catch (error) {
      console.error('Request error:', error)
      const errorResponse = new Response(
        JSON.stringify({ error: error.message || 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(errorResponse, corsResult.origin)
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
    console.error('EEN token error:', errorText)
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
        baseUrl = `https://${host}${port && port !== 443 ? ':' + port : ''}`
      }
    }
    console.log('Fetching user profile from:', `${baseUrl}/api/v3.0/users/self`)
    const userResponse = await fetch(`${baseUrl}/api/v3.0/users/self`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json'
      }
    })
    console.log('User profile response status:', userResponse.status)
    if (userResponse.ok) {
      const userData = await userResponse.json()
      console.log('User data received, email:', userData.email)
      userEmail = userData.email
    } else {
      const errorText = await userResponse.text()
      console.error('User profile fetch failed:', userResponse.status, errorText)
    }
  } catch (e) {
    console.error('Failed to fetch user email:', e)
  }

  // Generate session ID and store refresh token
  const sessionId = crypto.randomUUID()
  const sessionData = {
    refreshToken: tokens.refresh_token,
    userEmail: userEmail,
    createdAt: Date.now()
  }

  // Store in KV with TTL matching token expiry (plus configurable buffer for refresh)
  const refreshTokenTtl = parseInt(env.REFRESH_TOKEN_TTL, 10) || 86400
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
  const sessionId = getSessionIdFromCookie(request)
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
    console.error('EEN refresh error:', errorText)
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

  const refreshTokenTtl = parseInt(env.REFRESH_TOKEN_TTL, 10) || 86400
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
  const sessionId = getSessionIdFromCookie(request)
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
      console.error('Failed to revoke token at EEN:', e)
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
    console.error('Failed to get version from KV:', e)
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
  const sessionId = getSessionIdFromCookie(request)
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

  // Filter out special keys like DEPLOY_VERSION
  const sessionKeys = listResult.keys.filter(key => !key.name.startsWith('DEPLOY_'))

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

  const currentSessionId = getSessionIdFromCookie(request)
  const listResult = await env.EEN_OAUTH_SESSIONS.list()

  let deletedCount = 0
  for (const key of listResult.keys) {
    // Skip current session and special keys
    if (key.name === currentSessionId || key.name.startsWith('DEPLOY_')) {
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

  const currentSessionId = getSessionIdFromCookie(request)
  const listResult = await env.EEN_OAUTH_SESSIONS.list()

  let revokedCount = 0
  let errorCount = 0

  for (const key of listResult.keys) {
    // Skip special keys
    if (key.name.startsWith('DEPLOY_')) {
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
      console.error(`Failed to revoke session ${key.name}:`, e)
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
// Helper Functions
// ============================================================================

/**
 * Validate request origin against allowed origins
 */
function validateOrigin(origin, env) {
  if (!origin) {
    // Allow requests without origin (e.g., from tools like curl)
    return { valid: true, origin: '*' }
  }

  // Parse allowed origins from env
  const allowedOriginsStr = env.ALLOWED_ORIGINS || ''
  const allowedOrigins = allowedOriginsStr
    .split(',')
    .map(o => o.trim())
    .filter(o => o.length > 0)

  // In development, also allow localhost
  if (env.ENVIRONMENT === 'development') {
    allowedOrigins.push(
      'http://localhost:3333',
      'http://127.0.0.1:3333'
    )
  }

  if (allowedOrigins.includes(origin)) {
    return { valid: true, origin }
  }

  return { valid: false, origin: null }
}

/**
 * Handle CORS preflight requests
 */
function handleCorsPreflightRequest(origin) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin)
  })
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response, origin) {
  const newHeaders = new Headers(response.headers)
  const corsHeaders = getCorsHeaders(origin)

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
 * Get CORS headers
 */
function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  }
}

/**
 * Extract session ID from cookie header
 * Returns null for missing or invalid session IDs
 */
function getSessionIdFromCookie(request) {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map(c => c.trim())
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=')
    if (name === 'sessionId') {
      // Validate session ID format (UUID = 36 chars, allow up to 50 for safety)
      // KV keys have a 512 byte limit, reject anything too long
      if (!value || value.length > 50) {
        console.warn('Invalid session ID length:', value?.length)
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
  const sessionId = getSessionIdFromCookie(request)
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
    console.log('userEmail missing, fetching from EEN...')
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
            baseUrl = `https://${host}${port && port !== 443 ? ':' + port : ''}`
          }
        }
        console.log('On-demand fetch: using baseUrl:', baseUrl)

        // Fetch user profile
        const userResponse = await fetch(`${baseUrl}/api/v3.0/users/self`, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/json'
          }
        })

        if (userResponse.ok) {
          const userData = await userResponse.json()
          console.log('Fetched user email on-demand:', userData.email)

          // Update session with email
          sessionData.userEmail = userData.email
          sessionData.refreshToken = tokens.refresh_token || sessionData.refreshToken
          await env.EEN_OAUTH_SESSIONS.put(sessionId, JSON.stringify(sessionData), {
            expirationTtl: 86400 * 2  // 2 days
          })
        }
      }
    } catch (e) {
      console.error('Failed to fetch user email on-demand:', e)
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
