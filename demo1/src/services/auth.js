/**
 * Authentication service for EEN OAuth
 */

import { getProxyUrlOrThrow } from './proxy'

const CLIENT_ID = import.meta.env.VITE_EEN_CLIENT_ID || ''
const AUTH_URL = import.meta.env.VITE_EEN_AUTH_URL || 'https://auth.eagleeyenetworks.com/oauth2/authorize'
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || window.location.origin

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }
  if (a.length !== b.length) {
    return false
  }
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
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

  const response = await fetch(`${getProxyUrlOrThrow()}/proxy/getAccessToken?${params.toString()}`, {
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

  const response = await fetch(`${getProxyUrlOrThrow()}/proxy/refreshAccessToken`, {
    method: 'POST',
    credentials: 'include'
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
  const response = await fetch(`${getProxyUrlOrThrow()}/proxy/revoke`, {
    method: 'POST',
    credentials: 'include'
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
  sessionStorage.removeItem('oauth_state')

  if (!state || !storedState || !constantTimeCompare(state, storedState)) {
    throw new Error('Invalid OAuth state')
  }

  const { useAuthStore } = await import('../stores/auth')
  const authStore = useAuthStore()

  const data = await getAccessToken(code)

  // Store tokens and base URL
  authStore.setToken(data.accessToken, data.expiresIn)
  authStore.setRefreshToken('present')

  if (data.httpsBaseUrl) {
    // httpsBaseUrl can be either a string URL or an object with hostname/port
    if (typeof data.httpsBaseUrl === 'string') {
      // Parse string URL to extract hostname and port
      try {
        const url = new URL(data.httpsBaseUrl)
        authStore.setBaseUrl({
          hostname: url.hostname,
          port: url.port ? parseInt(url.port, 10) : 443
        })
      } catch (e) {
        // If URL parsing fails, assume it's just a hostname
        authStore.setBaseUrl({ hostname: data.httpsBaseUrl })
      }
    } else if (typeof data.httpsBaseUrl === 'object' && data.httpsBaseUrl !== null) {
      // Already an object with hostname and possibly port
      authStore.setBaseUrl({
        hostname: data.httpsBaseUrl.hostname || data.httpsBaseUrl.host,
        port: data.httpsBaseUrl.port ? parseInt(data.httpsBaseUrl.port, 10) : 443
      })
    }
  }

  return data
}
