/**
 * Authentication service for EEN OAuth
 */

const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'http://localhost:8787'
const CLIENT_ID = import.meta.env.VITE_EEN_CLIENT_ID || ''
const AUTH_URL = import.meta.env.VITE_EEN_AUTH_URL || 'https://auth.eagleeyenetworks.com/oauth2/authorize'
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || window.location.origin + '/'

/**
 * Get the EEN OAuth authorization URL
 */
export function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'vms.all'
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

  const response = await fetch(`${PROXY_URL}/proxy/getAccessToken?${params.toString()}`, {
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
 * Revoke tokens via proxy
 */
export async function revokeToken() {
  const response = await fetch(`${PROXY_URL}/proxy/revoke`, {
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
export async function handleAuthCallback(code) {
  const { useAuthStore } = await import('../stores/auth')
  const authStore = useAuthStore()

  const data = await getAccessToken(code)

  // Store tokens and base URL
  authStore.setToken(data.accessToken, data.expiresIn)
  authStore.setRefreshToken('present')

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
