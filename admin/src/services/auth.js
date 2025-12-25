/**
 * Authentication service for EEN OAuth
 */

import { getProxyUrl } from './admin'

/**
 * Get authentication headers (Bearer token with session ID)
 */
async function getAuthHeaders() {
  // Dynamic import to avoid circular dependencies
  const { useAuthStore } = await import('../stores/auth')
  const authStore = useAuthStore()
  
  if (authStore.sessionId) {
    return {
      'Authorization': `Bearer ${authStore.sessionId}`
    }
  }
  return {}
}

const CLIENT_ID = import.meta.env.VITE_EEN_CLIENT_ID || ''
const AUTH_URL = import.meta.env.VITE_EEN_AUTH_URL || 'https://auth.eagleeyenetworks.com/oauth2/authorize'
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || window.location.origin

/**
 * Constant-time string comparison to prevent timing attacks.
 * Always iterates based on the stored value (b) length to ensure
 * constant execution time regardless of attacker-controlled input.
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }

  // Track length mismatch but don't short-circuit
  let mismatch = a.length !== b.length ? 1 : 0

  // Always iterate based on stored state (b) length for constant time
  for (let i = 0; i < b.length; i++) {
    const aChar = i < a.length ? a.charCodeAt(i) : 0
    const bChar = b.charCodeAt(i)
    mismatch |= aChar ^ bChar
  }

  return mismatch === 0
}

/**
 * Get the EEN OAuth authorization URL
 */
export function getAuthUrl() {
  // Generate a random state for CSRF protection (122-bit entropy, UUID v4)
  const state = crypto.randomUUID()
  sessionStorage.setItem('oauth_state', state)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'vms.all',
    state: state
  })

  return `${AUTH_URL}?${params.toString()}`
}

/**
 * Exchange authorization code for access token via proxy
 */
export async function getAccessToken(code) {
  const params = new URLSearchParams({
    code,
    redirect_uri: REDIRECT_URI
  })

  const response = await fetch(`${getProxyUrl()}/proxy/getAccessToken?${params.toString()}`, {
    method: 'POST',
    credentials: 'include'
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Token exchange failed' }))
    throw new Error(error.error || 'Token exchange failed')
  }

  return response.json()
}

/**
 * Refresh access token via proxy
 */
export async function refreshToken() {
  const { useAuthStore } = await import('../stores/auth')
  const authStore = useAuthStore()
  const headers = await getAuthHeaders()

  const response = await fetch(`${getProxyUrl()}/proxy/refreshAccessToken`, {
    method: 'POST',
    credentials: 'include',
    headers
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Token refresh failed' }))
    throw new Error(error.error || 'Token refresh failed')
  }

  const data = await response.json()

  // Update store with new token
  authStore.setToken(data.accessToken, data.expiresIn)

  return data
}

/**
 * Revoke tokens via proxy
 */
export async function revokeToken() {
  const headers = await getAuthHeaders()
  const response = await fetch(`${getProxyUrl()}/proxy/revoke`, {
    method: 'POST',
    credentials: 'include',
    headers
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Token revocation failed' }))
    throw new Error(error.error || 'Token revocation failed')
  }

  return response.json()
}

/**
 * Handle OAuth callback
 */
export async function handleAuthCallback(code, state) {
  // Verify state to prevent CSRF (use constant-time comparison to prevent timing attacks)
  const storedState = sessionStorage.getItem('oauth_state')
  // Remove state immediately to prevent replay attacks
  sessionStorage.removeItem('oauth_state')

  if (!state || !storedState || !constantTimeCompare(state, storedState)) {
    // Log failed state validation for security monitoring (no sensitive data)
    console.warn('[Security] OAuth state validation failed:', {
      hasState: !!state,
      hasStoredState: !!storedState,
      timestamp: new Date().toISOString()
    })
    throw new Error('Invalid OAuth state')
  }

  const { useAuthStore } = await import('../stores/auth')
  const authStore = useAuthStore()

  const data = await getAccessToken(code)

  // Store tokens and base URL
  authStore.setToken(data.accessToken, data.expiresIn)
  authStore.setRefreshToken('present')
  
  // Store session ID if present (for header-based auth on mobile/cross-site)
  if (data.sessionId) {
    authStore.setSessionId(data.sessionId)
  }

  if (data.httpsBaseUrl) {
    // Parse httpsBaseUrl to extract hostname and port
    try {
      const url = new URL(data.httpsBaseUrl)
      authStore.setBaseUrl({
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 443
      })
    } catch (e) {
      authStore.setBaseUrl({ hostname: data.httpsBaseUrl })
    }
  }

  // Use userEmail from proxy response if available
  if (data.userEmail) {
    authStore.setUserProfile({ email: data.userEmail })
  }

  return data
}
