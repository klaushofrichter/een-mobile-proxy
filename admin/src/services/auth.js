/**
 * Authentication service for EEN OAuth
 *
 * All proxy calls use relative URLs (same-origin via Workers Static Assets).
 */

import { getAuthHeaders } from '../utils/auth-headers'

const CLIENT_ID = import.meta.env.VITE_EEN_CLIENT_ID || ''
const AUTH_URL = import.meta.env.VITE_EEN_AUTH_URL || 'https://auth.eagleeyenetworks.com/oauth2/authorize'
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || window.location.origin

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }

  let mismatch = a.length !== b.length ? 1 : 0

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
  const response = await fetch('/proxy/getAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, redirect_uri: REDIRECT_URI }).toString()
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

  const response = await fetch('/proxy/refreshAccessToken', {
    method: 'POST',
    headers
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Token refresh failed' }))
    throw new Error(error.error || 'Token refresh failed')
  }

  const data = await response.json()
  authStore.setToken(data.accessToken, data.expiresIn)

  return data
}

/**
 * Revoke tokens via proxy
 */
export async function revokeToken() {
  const headers = await getAuthHeaders()
  const response = await fetch('/proxy/revoke', {
    method: 'POST',
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
  const storedState = sessionStorage.getItem('oauth_state')
  sessionStorage.removeItem('oauth_state')

  if (!state || !storedState || !constantTimeCompare(state, storedState)) {
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

  authStore.setToken(data.accessToken, data.expiresIn)
  authStore.setRefreshToken('present')

  if (data.sessionId) {
    authStore.setSessionId(data.sessionId)
  }

  if (data.httpsBaseUrl) {
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

  if (data.userEmail) {
    authStore.setUserProfile({ email: data.userEmail })
  }

  return data
}
