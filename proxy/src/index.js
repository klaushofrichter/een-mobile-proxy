/**
 * EEN Mobile OAuth Proxy - Cloudflare Worker
 *
 * This worker handles OAuth authentication with Eagle Eye Networks (EEN) services
 * for mobile (iOS/Android) applications. It keeps CLIENT_ID and CLIENT_SECRET
 * secure on the server side.
 *
 * Key differences from the web proxy (een-oauth-proxy):
 *   - No CORS headers (native mobile clients don't need CORS)
 *   - No cookies -- sessions are identified via Authorization: Bearer <sessionId>
 *   - No Origin header requirement (mobile HTTP clients don't send Origin)
 *   - Redirect URIs validated by scheme (e.g., myapp://) instead of origin domain
 *   - No browser-specific security headers (X-Frame-Options, CSP, HSTS)
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
 *   GET    /admin/debugMode        - Get current debug mode state
 *   POST   /admin/debugMode        - Enable or disable debug mode
 *   POST   /admin/debugStatus      - Dump KV status to console (requires debug mode)
 *
 * Rate Limiting:
 *   Configurable via environment variables:
 *   - RATE_LIMIT_ENABLED: 'true' to enable (default: true)
 *   - RATE_LIMIT_HEALTH: requests/minute for /health (default: 60)
 *   - RATE_LIMIT_OAUTH: requests/minute for /proxy/* (default: 60)
 *   - RATE_LIMIT_ADMIN: requests/minute for /admin/* (default: 60)
 *   - RATE_LIMIT_WINDOW: time window in seconds (default: 60)
 *
 * KV Key Limit:
 *   - MAX_KV_KEYS: max keys to enumerate from KV (default: 10000, range: 1000–100000)
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
const DEFAULT_RATE_LIMIT_OAUTH = 60 // requests per window
const DEFAULT_RATE_LIMIT_ADMIN = 60 // requests per window
const DEFAULT_RATE_LIMIT_WINDOW = 60 // seconds
const DEFAULT_RATE_LIMIT_UNKNOWN = 5 // very restrictive limit for unidentified clients

// KV key enumeration limits
const MIN_MAX_KV_KEYS = 1000
const DEFAULT_MAX_KV_KEYS = 10000
const MAX_MAX_KV_KEYS = 100000

/**
 * Maximum allowed POST body size in bytes for token exchange requests.
 * OAuth parameters (code + redirect_uri) should be well under 1KB.
 * This limit prevents DoS via oversized payloads. Cloudflare Workers
 * also enforces its own hard request size limits (~100MB paid, ~10MB free).
 */
const MAX_POST_BODY_SIZE = 10000

// SSRF protection constants
const MAX_ALLOWED_DOMAINS_CONFIG_LENGTH = 1024 // Max length of ALLOWED_API_DOMAINS config string
const MAX_DEBUG_LOG_VALUE_LENGTH = 100 // Max length for user-controlled values in debug logs

// Sensitive field names for debug log masking (show only last 4 chars)
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'access_token', 'refresh_token', 'refreshtoken',
  'client_secret', 'secret', 'code', 'authorization', 'cookie'
])

// Rate limit categories
const RATE_LIMIT_CATEGORY = {
  HEALTH: 'health',
  OAUTH: 'oauth',
  ADMIN: 'admin'
}

/**
 * Parse a comma-separated env string into a trimmed, lowercased, non-empty array
 */
function parseEnvList(str) {
  return (str || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0)
}

// Debug mode auto-disable timeout
const DEBUG_MODE_TTL_SECONDS = 600 // 10 minutes

// Cache for debug mode state (avoids KV read on every request)
let cachedDebugMode = false
let cachedDebugModeExpiresAt = 0
let cachedDebugModeTimestamp = 0
const DEBUG_MODE_CACHE_TTL = 5000 // 5 seconds

// Cache for parsed ALLOWED_SCHEMES (persists within worker instance)
let cachedAllowedSchemesEnv = null
let cachedAllowedSchemes = null

// Cache for parsed ALLOWED_API_DOMAINS (persists within worker instance)
let cachedAllowlistConfig = null
let cachedAllowlist = null

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
 * Truncate a value for safe debug logging
 * Prevents log flooding from large user-controlled values
 * @param {string} value - Value to truncate
 * @param {number} maxLength - Maximum length (default: MAX_DEBUG_LOG_VALUE_LENGTH)
 * @returns {string} - Truncated value with indicator if truncated
 */
function truncateForLog(value, maxLength = MAX_DEBUG_LOG_VALUE_LENGTH) {
  if (typeof value !== 'string') {
    value = String(value)
  }
  if (value.length <= maxLength) {
    return value
  }
  return value.substring(0, maxLength) + '...[truncated]'
}

/**
 * Mask a sensitive value, showing only the last 4 characters
 * @param {string} value - The sensitive value to mask
 * @returns {string} - Masked value like "****abcd"
 */
function maskSensitiveValue(value) {
  if (typeof value !== 'string' || value.length === 0) return '****'
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

/**
 * Sanitize an object for debug logging, masking sensitive fields
 * @param {Object} obj - Object to sanitize
 * @returns {Object} - Sanitized copy
 */
function sanitizeForLog(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const sanitized = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = maskSensitiveValue(String(value))
    } else if (typeof value === 'string') {
      sanitized[key] = truncateForLog(value)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

/**
 * Log incoming request details to console when debug mode is enabled.
 * Checks the DEBUG_MODE KV key. Sensitive fields are masked.
 * @param {Request} request - Incoming request
 * @param {URL} url - Parsed URL
 * @param {Object} env - Environment bindings
 */
async function debugLogRequest(request, url, env) {
  try {
    // Use cached value if fresh enough to avoid KV read on every request
    const now = Date.now()
    if (now - cachedDebugModeTimestamp > DEBUG_MODE_CACHE_TTL) {
      const expiresAt = await env.EEN_OAUTH_SESSIONS.get('DEBUG_MODE')
      cachedDebugModeExpiresAt = expiresAt ? parseInt(expiresAt, 10) : 0
      cachedDebugMode = cachedDebugModeExpiresAt > now
      cachedDebugModeTimestamp = now
    }
    if (!cachedDebugMode || cachedDebugModeExpiresAt <= now) return

    const method = request.method
    const path = url.pathname

    // Skip internal Cloudflare/wrangler dev server requests
    if (path.startsWith('/cdn-cgi/')) return

    // Skip admin SPA and static asset requests
    if (path === '/' || path.startsWith('/assets/') || path === '/favicon.ico') return
    const timestamp = new Date().toISOString()

    // Collect sanitized headers of interest
    const headerInfo = {}
    const authHeader = request.headers.get('Authorization')
    if (authHeader) headerInfo.authorization = maskSensitiveValue(authHeader)
    const contentType = request.headers.get('Content-Type')
    if (contentType) headerInfo['content-type'] = contentType

    const logEntry = { timestamp, method, path, headers: headerInfo }

    // Parse body for POST requests
    if (method === 'POST') {
      try {
        const cloned = request.clone()
        const body = await cloned.text()
        if (body) {
          // Try URL-encoded form data first, then JSON
          if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
            const params = Object.fromEntries(new URLSearchParams(body))
            logEntry.body = sanitizeForLog(params)
          } else if (contentType && contentType.includes('application/json')) {
            const json = JSON.parse(body)
            logEntry.body = sanitizeForLog(json)
          } else {
            logEntry.body = truncateForLog(body, 200)
          }
        }
      } catch {
        logEntry.body = '[unreadable]'
      }
    }

    // Add query params if present (sanitized)
    if (url.search) {
      const params = Object.fromEntries(url.searchParams)
      logEntry.query = sanitizeForLog(params)
    }

    console.log('[DEBUG]', JSON.stringify(logEntry))
  } catch {
    // Debug logging should never break request handling
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
 * Get the maximum number of KV keys to enumerate, bounded to safe range.
 * Configurable via MAX_KV_KEYS environment variable (default: 10000, range: 1000–100000).
 * @param {Object} env - Environment bindings
 * @returns {number} - Max KV keys (bounded between 1000 and 100000)
 */
function getMaxKvKeys(env) {
  const parsed = parseInt(env.MAX_KV_KEYS, 10)
  if (isNaN(parsed)) return DEFAULT_MAX_KV_KEYS
  return Math.max(MIN_MAX_KV_KEYS, Math.min(parsed, MAX_MAX_KV_KEYS))
}

/**
 * List all KV keys, paginating through results if there are more than 1000.
 * Cloudflare KV .list() returns at most 1000 keys per call.
 * Stops after MAX_KEYS to prevent runaway loops and excessive memory usage.
 * Configurable via MAX_KV_KEYS env var (default: 10000, range: 1000–100000).
 * @param {Object} kvNamespace - Cloudflare KV namespace binding
 * @param {Object} [options] - Options passed to KV .list() (e.g. { prefix: '...' })
 * @param {Object} [env] - Environment bindings (for warning log on truncation and config)
 * @returns {Promise<{keys: Array<{name: string}>, truncated: boolean}>}
 */
async function listAllKVKeys(kvNamespace, options = {}, env = null) {
  const allKeys = []
  let cursor = undefined
  const MAX_KEYS = env ? getMaxKvKeys(env) : DEFAULT_MAX_KV_KEYS

  do {
    const listOpts = { ...options }
    if (cursor) listOpts.cursor = cursor
    const result = await kvNamespace.list(listOpts)
    allKeys.push(...result.keys)
    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor && allKeys.length < MAX_KEYS)

  const truncated = allKeys.length >= MAX_KEYS && !!cursor
  if (truncated && env) {
    debugError(env, `listAllKVKeys truncated at ${MAX_KEYS} keys (prefix: ${options.prefix || 'none'})`)
  }

  return { keys: allKeys, truncated }
}

/**
 * Validates that a URL is a legitimate API endpoint based on configured allowlist.
 * Prevents SSRF attacks by only allowing configured domains.
 * @param {string} url - The URL to validate
 * @param {Object} env - Environment bindings containing ALLOWED_API_DOMAINS
 * @returns {boolean} - True if URL is safe to use
 */
function isValidEenUrl(url, env) {
  try {
    const parsed = new URL(url)

    // Must be HTTPS protocol
    if (parsed.protocol !== 'https:') {
      debugLog(env, `[SSRF] Blocked non-HTTPS URL: ${truncateForLog(parsed.protocol)}`)
      return false
    }

    const hostname = parsed.hostname.toLowerCase()

    // Block IP addresses (IPv4, IPv6, and numeric representations)
    // IPv4: 192.168.1.1
    // IPv6: [::1], [fe80::1], or with :: shorthand
    // IPv4-mapped IPv6: ::ffff:192.0.2.1, 0:0:0:0:0:ffff:192.0.2.1
    // Numeric: 2130706433 (decimal representation of 127.0.0.1)
    // Octal/Hex: 0177.0.0.1, 0x7f.0.0.1
    const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
    // IPv6 detection: bracketed format [xxx] or contains :: (IPv6 shorthand)
    // or has 2+ colons with hex segments (full IPv6 like 2001:db8:85a3::1)
    const isIPv6Bracketed = /^\[.+\]$/.test(hostname)
    const isIPv6Shorthand = hostname.includes('::')
    const isIPv6Full = /^[0-9a-f]+:[0-9a-f]+:/i.test(hostname)
    // IPv4-mapped/compatible IPv6 addresses (e.g., ::ffff:192.168.1.1 or containing IPv4 after colon)
    const isIPv4Mapped = /:[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(hostname)
    const isNumericIP = /^\d+$/.test(hostname)
    const isOctalOrHex = /^0[0-7x]/i.test(hostname) || /\.0[0-7x]/i.test(hostname)

    if (isIPv4 || isIPv6Bracketed || isIPv6Shorthand || isIPv6Full || isIPv4Mapped || isNumericIP || isOctalOrHex) {
      debugLog(env, `[SSRF] Blocked IP-based hostname: ${truncateForLog(hostname)}`)
      return false
    }

    // Block non-ASCII domains (prevent Unicode/IDN homograph attacks)
    if (!/^[a-z0-9.-]+$/.test(hostname)) {
      debugLog(env, `[SSRF] Blocked non-ASCII hostname: ${truncateForLog(hostname)}`)
      return false
    }

    // Get allowed domains from environment (default: eagleeyenetworks.com)
    // Uses caching to avoid re-parsing on every request
    const rawAllowedDomains = env.ALLOWED_API_DOMAINS || 'eagleeyenetworks.com'

    // Use cached allowlist if config hasn't changed
    let allowedDomains
    if (cachedAllowlistConfig === rawAllowedDomains && cachedAllowlist) {
      allowedDomains = cachedAllowlist
    } else {
      // Parse and cache the allowlist
      // Reject if config exceeds limit (fail-safe to prevent misconfiguration)
      if (rawAllowedDomains.length > MAX_ALLOWED_DOMAINS_CONFIG_LENGTH) {
        debugLog(env, `[SSRF] ALLOWED_API_DOMAINS config too long (${rawAllowedDomains.length} > ${MAX_ALLOWED_DOMAINS_CONFIG_LENGTH}), rejecting request`)
        return false
      }
      const allowedDomainsStr = rawAllowedDomains
      allowedDomains = allowedDomainsStr
        .split(',')
        .map((d) => d.trim().toLowerCase())
        // Filter out empty strings, wildcards, and invalid entries
        // Note: Single-char TLDs (e.g., "x") are technically allowed by this regex
        // but will fail the subdomain check unless explicitly configured
        // Also filter out invalid DNS patterns: consecutive dots, leading/trailing dots
        .filter((d) => d && d.length <= 253 && !/[*?]/.test(d) && /^[a-z0-9.-]+$/.test(d) && !/\.\./.test(d) && !/^\.|\.$/.test(d))

      // Fallback to default if config is invalid
      if (allowedDomains.length === 0) {
        allowedDomains = ['eagleeyenetworks.com']
      }

      // Update cache
      cachedAllowlistConfig = rawAllowedDomains
      cachedAllowlist = allowedDomains
    }

    // Check hostname against allowlist (exact match or subdomain)
    const isAllowed = allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    )
    if (!isAllowed) {
      debugLog(env, `[SSRF] Blocked hostname not in allowlist: ${truncateForLog(hostname)}`)
      return false
    }

    // No credentials allowed in URL
    if (parsed.username || parsed.password) {
      debugLog(env, `[SSRF] Blocked URL with embedded credentials`)
      return false
    }

    return true
  } catch (e) {
    debugLog(env, `[SSRF] Blocked malformed URL: ${truncateForLog(e.message)}`)
    return false
  }
}

/**
 * Constructs and validates a base URL from httpsBaseUrl token response.
 * Handles both string and object {hostname, port} formats.
 * @param {string|Object} httpsBaseUrl - The httpsBaseUrl from token response
 * @param {Object} env - Environment bindings
 * @returns {string|null} - Valid base URL or null if invalid
 */
function parseHttpsBaseUrl(httpsBaseUrl, env) {
  if (!httpsBaseUrl) {
    return null
  }

  let candidateUrl = null

  if (typeof httpsBaseUrl === 'string') {
    candidateUrl = httpsBaseUrl
  } else if (typeof httpsBaseUrl === 'object') {
    // Handle object format: {hostname: "c001.eagleeyenetworks.com", port: 443}
    const host = httpsBaseUrl.hostname || httpsBaseUrl.host
    const port = httpsBaseUrl.port

    // Validate hostname format:
    // - Must be a non-empty string
    // - Max 253 chars per DNS spec (RFC 1035)
    // - DNS-compliant: starts/ends with alphanumeric, allows dots/hyphens internally
    if (
      !host ||
      typeof host !== 'string' ||
      host.length > 253 ||
      !/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
    ) {
      return null
    }

    // Validate port if provided
    if (port !== undefined && port !== null) {
      // Reject malformed port strings like "8443xyz" - must be purely numeric or a number
      const portStr = String(port)
      if (!/^\d+$/.test(portStr)) {
        return null
      }
      const portNum = parseInt(portStr, 10)
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return null
      }
      candidateUrl = `https://${host}${portNum !== 443 ? ':' + portNum : ''}`
    } else {
      candidateUrl = `https://${host}`
    }
  }

  // Validate against SSRF allowlist
  if (candidateUrl && isValidEenUrl(candidateUrl, env)) {
    return candidateUrl
  }

  return null
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Rate limiting check
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
      return response
    }

    try {
      // Log request details if debug mode is enabled
      await debugLogRequest(request, url, env)

      // Route requests
      return await routeRequest(url, request, env)
    } catch (error) {
      debugError(env, 'Request error:', error)
      // Never expose internal error details to clients - use generic message
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
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
  if (path === '/admin/debugMode' && request.method === 'GET') {
    return handleAdminGetDebugMode(request, env)
  }
  if (path === '/admin/debugMode' && request.method === 'POST') {
    return handleAdminSetDebugMode(request, env)
  }
  if (path === '/admin/debugStatus' && request.method === 'POST') {
    return handleAdminDebugStatus(request, env)
  }

  // Health check (public endpoint, no auth required)
  // Accept both GET and HEAD (for monitoring services like UptimeRobot)
  if (path === '/health' && (request.method === 'GET' || request.method === 'HEAD')) {
    return handleHealth(env)
  }

  // Serve static assets (admin SPA)
  if (env.ASSETS) {
    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) {
      return assetResponse
    }
    // SPA fallback: serve index.html for unmatched routes
    const spaRequest = new Request(new URL('/', request.url), request)
    const spaResponse = await env.ASSETS.fetch(spaRequest)
    if (spaResponse.status === 200) {
      return spaResponse
    }
  }

  return new Response('Not Found', { status: 404 })
}

// ============================================================================
// OAuth Endpoint Handlers
// ============================================================================

/**
 * Exchange authorization code for access token
 * POST /proxy/getAccessToken
 *
 * Parameters can be provided via:
 * 1. POST body (application/x-www-form-urlencoded) - preferred, per RFC 6749 Section 4.1.3
 * 2. URL query string - supported for backwards compatibility
 *
 * Body parameters take priority over query string parameters.
 *
 * @param {string} code - Authorization code from OAuth redirect
 * @param {string} redirect_uri - Redirect URI used in the authorization request
 */
async function handleGetAccessToken(url, request, env) {
  // Parse POST body parameters if Content-Type is form-urlencoded
  let bodyParams = null
  try {
    const contentType = (request.headers.get('Content-Type') || '').toLowerCase().trim()
    if (contentType.startsWith('application/x-www-form-urlencoded')) {
      // Require Content-Length header to prevent DoS via unbounded body reads
      const rawContentLength = request.headers.get('Content-Length')
      if (rawContentLength === null) {
        return jsonResponse({ error: 'Content-Length header required' }, 411)
      }
      const contentLength = parseInt(rawContentLength, 10)
      if (isNaN(contentLength) || contentLength < 0 || contentLength > MAX_POST_BODY_SIZE) {
        return jsonResponse({ error: 'Invalid or oversized request body' }, 413)
      }
      // Note: request.text() consumes the body stream (single-read only)
      const bodyText = await request.text()
      // Validate actual body size in case Content-Length is mismatched
      if (bodyText.length > MAX_POST_BODY_SIZE) {
        return jsonResponse({ error: 'Invalid or oversized request body' }, 413)
      }
      bodyParams = new URLSearchParams(bodyText)
    }
  } catch (error) {
    // Malformed body - fall through to query string params
    debugLog(env, `Failed to parse request body (${error.message}), falling back to query params`)
  }

  // Body params take priority, fall back to query string
  const code = bodyParams?.get('code') || url.searchParams.get('code')
  const redirectUri = bodyParams?.get('redirect_uri') || url.searchParams.get('redirect_uri')

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
    const errorResponse = jsonResponse({ error: 'Token exchange failed' }, tokenResponse.status)
    errorResponse.headers.set('Cache-Control', 'no-store')
    errorResponse.headers.set('Pragma', 'no-cache')
    return errorResponse
  }

  const tokens = await tokenResponse.json()

  // Fetch user profile to get email for admin verification
  // Use the httpsBaseUrl from token response (regional endpoint)
  // SECURITY: Validate URL against allowlist to prevent SSRF attacks
  let userEmail = null
  try {
    let baseUrl = 'https://api.eagleeyenetworks.com'
    const validatedUrl = parseHttpsBaseUrl(tokens.httpsBaseUrl, env)
    if (validatedUrl) {
      baseUrl = validatedUrl
    } else if (tokens.httpsBaseUrl) {
      // Log rejection in production for security monitoring
      console.warn('[SECURITY] SSRF protection: rejected invalid httpsBaseUrl', {
        type: typeof tokens.httpsBaseUrl,
        isObject: typeof tokens.httpsBaseUrl === 'object'
      })
      debugError(env, 'Rejected invalid httpsBaseUrl (SSRF protection):', tokens.httpsBaseUrl)
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
    userEmail: userEmail,  // Include email so frontend knows who's logged in
    sessionId: sessionId   // Return session ID for header-based auth (mobile support)
  }

  const response = jsonResponse(responseData)

  // RFC 6749 Section 5.1: token responses must not be cached
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Pragma', 'no-cache')

  return response
}

/**
 * Refresh access token using stored refresh token
 * POST /proxy/refreshAccessToken
 */
async function handleRefreshAccessToken(request, env) {
  const sessionId = getSessionId(request, env)
  if (!sessionId) {
    const errorResponse = jsonResponse({ error: 'No session found' }, 401)
    errorResponse.headers.set('Cache-Control', 'no-store')
    errorResponse.headers.set('Pragma', 'no-cache')
    return errorResponse
  }

  // Get stored session data
  const sessionDataStr = await env.EEN_OAUTH_SESSIONS.get(sessionId)
  if (!sessionDataStr) {
    const errorResponse = jsonResponse({ error: 'Session expired or invalid' }, 401)
    errorResponse.headers.set('Cache-Control', 'no-store')
    errorResponse.headers.set('Pragma', 'no-cache')
    return errorResponse
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
    // Don't delete session on refresh failure — let TTL handle expiration.
    // Avoids race condition where concurrent successful refresh wrote a new
    // token but KV eventual consistency returns stale data on re-read.
    const errorResponse = jsonResponse({ error: 'Token refresh failed' }, tokenResponse.status)
    errorResponse.headers.set('Cache-Control', 'no-store')
    errorResponse.headers.set('Pragma', 'no-cache')
    return errorResponse
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

  const response = jsonResponse({
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in
  })

  // RFC 6749 Section 5.1: token responses must not be cached
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Pragma', 'no-cache')

  return response
}

/**
 * Revoke tokens and clear session
 * POST /proxy/revoke
 */
async function handleRevoke(request, env) {
  const sessionId = getSessionId(request, env)
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

  return jsonResponse({ message: 'Token revoked successfully' })
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
  let debugMode = false
  try {
    const [deployVersion, debugModeExpiresAt] = await Promise.all([
      env.EEN_OAUTH_SESSIONS.get('DEPLOY_VERSION'),
      env.EEN_OAUTH_SESSIONS.get('DEBUG_MODE')
    ])
    if (deployVersion) {
      version = deployVersion
    }
    debugMode = debugModeExpiresAt ? parseInt(debugModeExpiresAt, 10) > Date.now() : false
  } catch (e) {
    // KV might not be available in some contexts
    debugError(env, 'Failed to get version from KV:', e)
  }

  return jsonResponse({
    status: 'ok',
    version: version,
    timestamp: new Date().toISOString(),
    debugMode
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
  const sessionId = getSessionId(request, env)
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

  const { keys, truncated } = await listAllKVKeys(env.EEN_OAUTH_SESSIONS, {}, env)

  // Filter out special keys (DEPLOY_*, RATE_LIMIT:*, DEBUG_MODE)
  const sessionKeys = keys.filter(
    key => !key.name.startsWith('DEPLOY_') && !key.name.startsWith('RATE_LIMIT:') && key.name !== 'DEBUG_MODE'
  )

  return jsonResponse({
    sessionCount: sessionKeys.length,
    ...(truncated && { truncated })
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

  const currentSessionId = getSessionId(request, env)
  const { keys, truncated } = await listAllKVKeys(env.EEN_OAUTH_SESSIONS, {}, env)

  let deletedCount = 0
  for (const key of keys) {
    // Skip current session and special keys (DEPLOY_*, RATE_LIMIT:*, DEBUG_MODE)
    if (
      key.name === currentSessionId ||
      key.name.startsWith('DEPLOY_') ||
      key.name.startsWith('RATE_LIMIT:') ||
      key.name === 'DEBUG_MODE'
    ) {
      continue
    }

    await env.EEN_OAUTH_SESSIONS.delete(key.name)
    deletedCount++
  }

  return jsonResponse({
    message: 'Sessions removed successfully',
    deletedSessions: deletedCount,
    remainingSessions: 1,
    ...(truncated && { truncated })
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

  const currentSessionId = getSessionId(request, env)
  const { keys, truncated } = await listAllKVKeys(env.EEN_OAUTH_SESSIONS, {}, env)

  let revokedCount = 0
  let errorCount = 0

  for (const key of keys) {
    // Skip special keys (DEPLOY_*, RATE_LIMIT:*, DEBUG_MODE)
    if (key.name.startsWith('DEPLOY_') || key.name.startsWith('RATE_LIMIT:') || key.name === 'DEBUG_MODE') {
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

  return jsonResponse({
    message: 'All tokens revoked',
    revokedSessions: revokedCount,
    errors: errorCount,
    ...(truncated && { truncated })
  })
}

/**
 * Get current debug mode state
 * GET /admin/debugMode
 */
async function handleAdminGetDebugMode(request, env) {
  const adminCheck = await checkAdminAccess(request, env)
  if (adminCheck.error) {
    return jsonResponse({ error: adminCheck.error }, adminCheck.status)
  }

  const expiresAt = await env.EEN_OAUTH_SESSIONS.get('DEBUG_MODE')
  const now = Date.now()
  const enabled = expiresAt ? parseInt(expiresAt, 10) > now : false
  const response = { enabled }
  if (enabled) {
    response.expiresAt = parseInt(expiresAt, 10)
  }
  return jsonResponse(response)
}

/**
 * Enable or disable debug mode
 * POST /admin/debugMode
 * Body: { "enabled": true|false }
 */
async function handleAdminSetDebugMode(request, env) {
  const adminCheck = await checkAdminAccess(request, env)
  if (adminCheck.error) {
    return jsonResponse({ error: adminCheck.error }, adminCheck.status)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.enabled !== 'boolean') {
    return jsonResponse({ error: 'Field "enabled" must be a boolean' }, 400)
  }

  const now = Date.now()
  let expiresAt = null

  if (body.enabled) {
    expiresAt = now + DEBUG_MODE_TTL_SECONDS * 1000
    await env.EEN_OAUTH_SESSIONS.put('DEBUG_MODE', String(expiresAt), {
      expirationTtl: DEBUG_MODE_TTL_SECONDS + 60 // KV TTL as safety net (extra 60s buffer)
    })
  } else {
    await env.EEN_OAUTH_SESSIONS.delete('DEBUG_MODE')
  }

  // Invalidate cache immediately so the change takes effect
  cachedDebugMode = body.enabled
  cachedDebugModeExpiresAt = expiresAt || 0
  cachedDebugModeTimestamp = now

  console.log(`[DEBUG] Debug mode ${body.enabled ? 'enabled (expires in 10min)' : 'disabled'} by ${adminCheck.sessionData.userEmail}`)

  const response = { enabled: body.enabled }
  if (expiresAt) {
    response.expiresAt = expiresAt
  }
  return jsonResponse(response)
}

/**
 * Dump KV status information to the console (requires debug mode)
 * POST /admin/debugStatus
 */
async function handleAdminDebugStatus(request, env) {
  const adminCheck = await checkAdminAccess(request, env)
  if (adminCheck.error) {
    return jsonResponse({ error: adminCheck.error }, adminCheck.status)
  }

  // Require debug mode to be active
  const expiresAt = await env.EEN_OAUTH_SESSIONS.get('DEBUG_MODE')
  const debugActive = expiresAt ? parseInt(expiresAt, 10) > Date.now() : false
  if (!debugActive) {
    return jsonResponse({ error: 'Debug mode is not enabled' }, 400)
  }

  const { keys, truncated } = await listAllKVKeys(env.EEN_OAUTH_SESSIONS, {}, env)

  // Categorize keys
  const sessions = []
  const rateLimitKeys = []
  const specialKeys = []

  for (const key of keys) {
    if (key.name.startsWith('RATE_LIMIT:')) {
      rateLimitKeys.push(key.name)
    } else if (key.name.startsWith('DEPLOY_') || key.name === 'DEBUG_MODE') {
      specialKeys.push(key.name)
    } else {
      sessions.push(key.name)
    }
  }

  // Build console output
  const lines = []
  lines.push('=== KV Status Dump ===')
  lines.push(`Total KV keys: ${keys.length}${truncated ? ' (truncated)' : ''}`)
  lines.push(`  Sessions: ${sessions.length}`)
  lines.push(`  Rate limit entries: ${rateLimitKeys.length}`)
  lines.push(`  Special keys: ${specialKeys.length}`)
  lines.push('')

  // Show up to 10 session details
  const sessionLimit = Math.min(sessions.length, 10)
  if (sessionLimit > 0) {
    lines.push(`Sessions (showing ${sessionLimit} of ${sessions.length}):`)
    for (let i = 0; i < sessionLimit; i++) {
      const sessionId = sessions[i]
      try {
        const dataStr = await env.EEN_OAUTH_SESSIONS.get(sessionId)
        if (dataStr) {
          const data = JSON.parse(dataStr)
          const age = data.createdAt ? Math.round((Date.now() - data.createdAt) / 60000) : '?'
          lines.push(`  ${maskSensitiveValue(sessionId)} | ${data.userEmail || 'unknown'} | age: ${age}min`)
        } else {
          lines.push(`  ${maskSensitiveValue(sessionId)} | [empty]`)
        }
      } catch {
        lines.push(`  ${maskSensitiveValue(sessionId)} | [error reading]`)
      }
    }
    if (sessions.length > 10) {
      lines.push(`  ... and ${sessions.length - 10} more`)
    }
  }

  // Show special keys
  if (specialKeys.length > 0) {
    lines.push('')
    lines.push('Special keys:')
    for (const key of specialKeys) {
      const value = await env.EEN_OAUTH_SESSIONS.get(key)
      if (key === 'DEBUG_MODE') {
        const exp = parseInt(value, 10)
        const remaining = Math.round((exp - Date.now()) / 1000)
        lines.push(`  ${key} = expires in ${remaining}s`)
      } else {
        lines.push(`  ${key} = ${truncateForLog(value || '[null]', 50)}`)
      }
    }
  }

  // Show rate limit summary
  if (rateLimitKeys.length > 0) {
    lines.push('')
    lines.push(`Rate limit entries: ${rateLimitKeys.length}`)
    const limit = Math.min(rateLimitKeys.length, 10)
    for (let i = 0; i < limit; i++) {
      const value = await env.EEN_OAUTH_SESSIONS.get(rateLimitKeys[i])
      lines.push(`  ${rateLimitKeys[i]} = ${value}`)
    }
    if (rateLimitKeys.length > 10) {
      lines.push(`  ... and ${rateLimitKeys.length - 10} more`)
    }
  }

  lines.push('=== End KV Status ===')

  console.log('[DEBUG-STATUS]\n' + lines.join('\n'))

  return jsonResponse({
    totalKeys: keys.length,
    sessions: sessions.length,
    rateLimitEntries: rateLimitKeys.length,
    specialKeys: specialKeys.length,
    truncated
  })
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
  const sessionId = getSessionId(request, env)
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
 * Check if request is rate limited. If not limited, synchronously increments
 * the counter before returning to reduce (not eliminate) concurrent burst bypass.
 * The read-modify-write cycle is still non-atomic — two concurrent requests can
 * both read the same count and each write count+1 instead of count+2. This means
 * rate limits are approximate under high concurrency: some requests may slip
 * through slightly over the limit. This is acceptable for abuse prevention —
 * the goal is deterrence, not precise counting.
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

    // Increment counter synchronously before returning
    await env.EEN_OAUTH_SESSIONS.put(key, String(count + 1), {
      expirationTtl: config.window * 2
    })
  } catch (e) {
    // If KV fails, allow the request (fail open)
    debugError(env, 'Rate limit check failed:', e)
  }

  return { limited: false }
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

  // Get current rate limit entries from KV (paginated)
  const { keys: rateLimitKeys, truncated } = await listAllKVKeys(env.EEN_OAUTH_SESSIONS, { prefix: 'RATE_LIMIT:' }, env)

  // Parse and aggregate stats
  const stats = {
    enabled: config.enabled,
    window: config.window,
    limits: config.limits,
    currentBucket: Math.floor(Date.now() / (config.window * 1000)),
    activeEntries: rateLimitKeys.length,
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

  for (const key of rateLimitKeys) {
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
  for (const key of rateLimitKeys) {
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

  if (truncated) stats.truncated = true
  stats.maxKvKeys = env ? getMaxKvKeys(env) : DEFAULT_MAX_KV_KEYS

  return jsonResponse(stats)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get list of allowed URI schemes from environment
 * For mobile apps, redirect URIs use custom schemes (e.g., myapp://callback)
 * ALLOWED_SCHEMES should be a comma-separated list of scheme names (without "://")
 */
function getAllowedSchemes(env) {
  const rawSchemes = env.ALLOWED_SCHEMES || ''
  if (cachedAllowedSchemesEnv === rawSchemes && cachedAllowedSchemes) {
    return cachedAllowedSchemes
  }

  const schemes = parseEnvList(rawSchemes)

  // In development, also allow http for local testing
  if (env.ENVIRONMENT === 'development' && !schemes.includes('http')) {
    schemes.push('http')
  }

  cachedAllowedSchemesEnv = rawSchemes
  cachedAllowedSchemes = schemes
  return schemes
}

/**
 * Validate redirect_uri against allowed schemes (prevent open redirect attacks)
 * For mobile apps, the redirect_uri's scheme must match one of the allowed schemes
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateRedirectUri(redirectUri, env) {
  if (!redirectUri || typeof redirectUri !== 'string') {
    return { valid: false, error: 'Invalid redirect_uri: missing or empty' }
  }

  // Extract scheme from redirect URI (everything before "://")
  const schemeMatch = redirectUri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
  if (!schemeMatch) {
    return { valid: false, error: 'Invalid redirect_uri: malformed URL (no scheme)' }
  }

  const scheme = schemeMatch[1].toLowerCase()
  const allowedSchemes = getAllowedSchemes(env)

  if (allowedSchemes.length === 0) {
    return { valid: false, error: 'No allowed schemes configured (set ALLOWED_SCHEMES)' }
  }

  if (!allowedSchemes.includes(scheme)) {
    return { valid: false, error: `Invalid redirect_uri: scheme '${scheme}' not allowed` }
  }

  return { valid: true }
}


/**
 * Extract session ID from cookie header
 * Returns null for missing or invalid session IDs
 */
// Session ID format: alphanumeric, hyphens, underscores only (prevents injection)
// Minimum 20 characters to prevent brute force attacks (UUIDs are 36 chars)
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{20,50}$/

function getSessionId(request, env) {
  // Mobile apps use Authorization: Bearer <sessionId> exclusively (no cookies)
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7).trim()

  // Validate format
  // Explicit length check prevents ReDoS on the regex
  if (!token || token.length > 50) {
    debugLog(env, 'Session ID in Authorization header too long or empty')
    return null
  }

  if (!SESSION_ID_REGEX.test(token)) {
    debugLog(env, 'Invalid session ID format in Authorization header')
    return null
  }

  return token
}

/**
 * Check if user email is in admin list
 */
function isAdminUser(userEmail, env) {
  if (!userEmail) return false
  return parseEnvList(env.ADMIN_EMAILS).includes(userEmail.toLowerCase())
}

/**
 * Check admin access for a request
 * If userEmail is missing, attempts to fetch it from EEN API
 */
async function checkAdminAccess(request, env) {
  const sessionId = getSessionId(request, env)
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

        // Parse httpsBaseUrl - SECURITY: Validate URL against allowlist to prevent SSRF attacks
        let baseUrl = 'https://api.eagleeyenetworks.com'
        const validatedUrl = parseHttpsBaseUrl(tokens.httpsBaseUrl, env)
        if (validatedUrl) {
          baseUrl = validatedUrl
        } else if (tokens.httpsBaseUrl) {
          // Log rejection in production for security monitoring
          console.warn('[SECURITY] SSRF protection: rejected invalid httpsBaseUrl', {
            type: typeof tokens.httpsBaseUrl,
            isObject: typeof tokens.httpsBaseUrl === 'object'
          })
          debugError(env, 'Rejected invalid httpsBaseUrl (SSRF protection):', tokens.httpsBaseUrl)
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

// Export SSRF validation functions for testing
export { isValidEenUrl, parseHttpsBaseUrl }
