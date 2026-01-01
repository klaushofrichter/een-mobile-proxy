/**
 * Admin service for proxy management
 */

import { getAuthHeaders } from '../utils/auth-headers'

const STORAGE_KEY = 'een_proxy_url'
const ENV_PROXY_URL = import.meta.env.VITE_PROXY_URL
const LOCAL_PROXY_URL = 'http://localhost:8787'
const DEFAULT_PROXY_URL = ENV_PROXY_URL || LOCAL_PROXY_URL

// Allowed proxy hosts for security validation (localhost for dev, ENV hostname for production)
const ALLOWED_PROXY_HOSTS = [
  'localhost',
  '127.0.0.1',
  '[::1]'  // IPv6 localhost (brackets required in URL hostname)
]

// Validate and extract ENV_PROXY_URL hostname at module initialization
let ENV_PROXY_HOSTNAME = null
if (ENV_PROXY_URL) {
  try {
    const parsed = new URL(ENV_PROXY_URL)
    // Only trust ENV_PROXY_URL if it's HTTPS (or localhost for dev)
    // Use toLowerCase() for case-insensitive protocol check
    if (parsed.protocol.toLowerCase() === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') {
      ENV_PROXY_HOSTNAME = parsed.hostname
    } else {
      console.warn('ENV_PROXY_URL must use HTTPS in production, ignoring:', ENV_PROXY_URL)
    }
  } catch (e) {
    console.warn('Invalid ENV_PROXY_URL format, ignoring:', ENV_PROXY_URL, '-', e.message)
  }
}



/**
 * Check if running in production build
 */
function isProduction() {
  return import.meta.env.PROD
}

/**
 * Validate if a URL is an allowed proxy URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if URL is valid and allowed
 * @exported for testing
 */
export function isValidProxyUrl(url) {
  try {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname

    // Check if hostname is in allowed list
    if (ALLOWED_PROXY_HOSTS.includes(hostname)) {
      return true
    }

    // Also allow validated ENV_PROXY_URL hostname if configured
    if (ENV_PROXY_HOSTNAME && hostname === ENV_PROXY_HOSTNAME) {
      return true
    }

    return false
  } catch {
    // Invalid URL format
    return false
  }
}

/**
 * Format a proxy URL for display in dropdown
 * Shows hostname and port only to prevent overly long labels
 * @param {string} url - Full proxy URL
 * @returns {string} - Formatted label (hostname:port or hostname)
 */
function formatProxyLabel(url) {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname + (urlObj.port ? `:${urlObj.port}` : '')
  } catch {
    return url
  }
}

/**
 * Get available proxy options based on environment
 * - In production: only the configured VITE_PROXY_URL
 * - In development: local and configured options
 */
export function getProxyOptions() {
  const options = []

  // In production, only show configured proxy; in dev, show local option too
  if (isProduction()) {
    if (ENV_PROXY_URL) {
      options.push({ label: formatProxyLabel(ENV_PROXY_URL), value: ENV_PROXY_URL })
    }
  } else {
    options.push({ label: formatProxyLabel(LOCAL_PROXY_URL), value: LOCAL_PROXY_URL })
    if (ENV_PROXY_URL && ENV_PROXY_URL !== LOCAL_PROXY_URL) {
      options.push({ label: formatProxyLabel(ENV_PROXY_URL), value: ENV_PROXY_URL })
    }
  }

  return options
}

/**
 * Get the configured proxy URL (from localStorage or default)
 * In production, requires VITE_PROXY_URL to be set and ignores localhost if stored
 */
export function getProxyUrl() {
  const stored = localStorage.getItem(STORAGE_KEY)

  if (isProduction()) {
    // In production, ENV_PROXY_URL must be configured
    if (!ENV_PROXY_URL) {
      console.error('VITE_PROXY_URL must be set for production builds')
      return null
    }
    // In production, don't use localhost even if stored
    if (!stored || stored === LOCAL_PROXY_URL) {
      return ENV_PROXY_URL
    }
    // Enforce HTTPS in production (case-insensitive check)
    if (!stored.toLowerCase().startsWith('https://')) {
      console.warn('HTTP proxy not allowed in production, using default')
      return ENV_PROXY_URL
    }
    // Validate the stored URL
    if (!isValidProxyUrl(stored)) {
      console.warn('Invalid proxy URL in storage, using default')
      return ENV_PROXY_URL
    }
    return stored
  }

  return stored || DEFAULT_PROXY_URL
}

/**
 * Set the proxy URL (stores in localStorage)
 * Validates URL before storing to prevent malicious redirects
 * @param {string} url - Proxy URL to store
 * @returns {boolean} - True if URL was stored, false if rejected
 */
export function setProxyUrl(url) {
  // Validate URL format and allowed hosts
  if (!isValidProxyUrl(url)) {
    console.warn('Rejected invalid proxy URL:', url)
    return false
  }

  // In production, enforce HTTPS (case-insensitive check)
  if (isProduction() && !url.toLowerCase().startsWith('https://')) {
    console.warn('HTTP proxy not allowed in production')
    return false
  }

  localStorage.setItem(STORAGE_KEY, url)
  return true
}

/**
 * Get proxy URL or throw an error if not configured
 * Use this for API calls to ensure we don't make requests to "null/..."
 * Exported for consistency with demo1 and potential external use
 * @returns {string} - The proxy URL
 * @throws {Error} if proxy URL is not configured
 */
export function getProxyUrlOrThrow() {
  const url = getProxyUrl()
  if (!url) {
    throw new Error('Proxy URL not configured. Set VITE_PROXY_URL in your environment.')
  }
  return url
}

/**
 * Verify current user has admin access
 * @returns {Promise<boolean>} true if user is admin, false otherwise
 * @throws {Error} if authentication failed or other error
 */
export async function verifyAdminAccess() {
  const headers = await getAuthHeaders()
  const response = await fetch(`${getProxyUrlOrThrow()}/admin/version`, {
    credentials: 'include',
    headers
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
    const response = await fetch(`${getProxyUrlOrThrow()}/health`, {
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
  const headers = await getAuthHeaders()
  const response = await fetch(`${getProxyUrlOrThrow()}/admin/version`, {
    credentials: 'include',
    headers
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
  const headers = await getAuthHeaders()
  const response = await fetch(`${getProxyUrlOrThrow()}/admin/sessionsCount`, {
    credentials: 'include',
    headers
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
  const headers = await getAuthHeaders()
  const response = await fetch(`${getProxyUrlOrThrow()}/admin/removeSessions`, {
    method: 'DELETE',
    credentials: 'include',
    headers
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
  const headers = await getAuthHeaders()
  const response = await fetch(`${getProxyUrlOrThrow()}/admin/revokeAll`, {
    method: 'POST',
    credentials: 'include',
    headers
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to revoke all tokens' }))
    throw new Error(error.error || 'Failed to revoke all tokens')
  }

  return response.json()
}
