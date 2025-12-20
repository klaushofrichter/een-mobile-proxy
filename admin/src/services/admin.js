/**
 * Admin service for proxy management
 */

const STORAGE_KEY = 'een_proxy_url'
const ENV_PROXY_URL = import.meta.env.VITE_PROXY_URL
const CLOUDFLARE_PROXY_URL = 'https://een-oauth-proxy.klaushofrichter.workers.dev'
const LOCAL_PROXY_URL = 'http://localhost:8787'
const DEFAULT_PROXY_URL = ENV_PROXY_URL || LOCAL_PROXY_URL

/**
 * Check if running in production (GitHub Pages)
 */
function isProduction() {
  return window.location.hostname.includes('github.io')
}

/**
 * Get available proxy options based on environment
 * - In production: only Cloudflare (and custom env if different)
 * - In development: both local and Cloudflare options
 */
export function getProxyOptions() {
  const options = []

  // In production, only show Cloudflare; in dev, show both
  if (isProduction()) {
    options.push({ label: 'Cloudflare (Workers)', value: CLOUDFLARE_PROXY_URL })
  } else {
    options.push({ label: 'Local (localhost:8787)', value: LOCAL_PROXY_URL })
    options.push({ label: 'Cloudflare (Workers)', value: CLOUDFLARE_PROXY_URL })
  }

  // Add env variable URL if it's different from predefined options
  if (ENV_PROXY_URL && !options.some((opt) => opt.value === ENV_PROXY_URL)) {
    options.unshift({ label: `Env (${ENV_PROXY_URL})`, value: ENV_PROXY_URL })
  }

  return options
}

/**
 * Get the configured proxy URL (from localStorage or default)
 * In production, defaults to Cloudflare and ignores localhost if stored
 */
export function getProxyUrl() {
  const stored = localStorage.getItem(STORAGE_KEY)

  if (isProduction()) {
    // In production, don't use localhost even if stored
    if (!stored || stored === LOCAL_PROXY_URL) {
      return CLOUDFLARE_PROXY_URL
    }
    return stored
  }

  return stored || DEFAULT_PROXY_URL
}

/**
 * Set the proxy URL (stores in localStorage)
 */
export function setProxyUrl(url) {
  localStorage.setItem(STORAGE_KEY, url)
}

/**
 * Verify current user has admin access
 * @returns {Promise<boolean>} true if user is admin, false otherwise
 * @throws {Error} if authentication failed or other error
 */
export async function verifyAdminAccess() {
  const response = await fetch(`${getProxyUrl()}/admin/version`, {
    credentials: 'include'
  })

  if (response.status === 403) {
    // User is authenticated but not an admin
    return false
  }

  if (response.status === 401) {
    throw new Error('Authentication required')
  }

  if (!response.ok) {
    throw new Error('Failed to verify admin access')
  }

  return true
}

/**
 * Check proxy health (public endpoint, no auth required)
 */
export async function getHealth() {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

  try {
    const response = await fetch(`${getProxyUrl()}/health`, {
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`)
    }

    return response.json()
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      throw new Error('Health check timed out')
    }
    throw new Error(e.message || 'Health check failed')
  }
}

/**
 * Get proxy version
 */
export async function getVersion() {
  const response = await fetch(`${getProxyUrl()}/admin/version`, {
    credentials: 'include'
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get version' }))
    throw new Error(error.error || 'Failed to get version')
  }

  return response.json()
}

/**
 * Get session count
 */
export async function getSessionsCount() {
  const response = await fetch(`${getProxyUrl()}/admin/sessionsCount`, {
    credentials: 'include'
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get session count' }))
    throw new Error(error.error || 'Failed to get session count')
  }

  return response.json()
}

/**
 * Remove all sessions except current
 */
export async function removeSessions() {
  const response = await fetch(`${getProxyUrl()}/admin/removeSessions`, {
    method: 'DELETE',
    credentials: 'include'
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to remove sessions' }))
    throw new Error(error.error || 'Failed to remove sessions')
  }

  return response.json()
}

/**
 * Revoke all tokens (emergency)
 */
export async function revokeAll() {
  const response = await fetch(`${getProxyUrl()}/admin/revokeAll`, {
    method: 'POST',
    credentials: 'include'
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to revoke all tokens' }))
    throw new Error(error.error || 'Failed to revoke all tokens')
  }

  return response.json()
}
