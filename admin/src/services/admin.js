/**
 * Admin service for proxy management
 *
 * All API calls use relative URLs since the admin SPA is served
 * from the same origin as the proxy (via Cloudflare Workers Static Assets).
 */

import { getAuthHeaders } from '../utils/auth-headers'

/**
 * Authenticated fetch helper for admin endpoints.
 * Handles auth headers, JSON body, and error parsing.
 */
async function adminFetch(path, { method = 'GET', body } = {}) {
  const headers = await getAuthHeaders()
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || `Request to ${path} failed`)
  }
  return response.json()
}

/**
 * Verify current user has admin access
 * @returns {Promise<boolean>} true if user is admin, false otherwise
 * @throws {Error} if authentication failed or other error
 */
export async function verifyAdminAccess() {
  const headers = await getAuthHeaders()
  const response = await fetch('/admin/version', { headers })

  if (response.status === 403) {
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
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch('/health', {
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

export const getVersion = () => adminFetch('/admin/version')
export const getSessionsCount = () => adminFetch('/admin/sessionsCount')
export const getRateLimitStats = () => adminFetch('/admin/rateLimitStats')
export const removeSessions = () => adminFetch('/admin/removeSessions', { method: 'DELETE' })
export const getDebugMode = () => adminFetch('/admin/debugMode')
export const setDebugMode = (enabled) => adminFetch('/admin/debugMode', { method: 'POST', body: { enabled } })
export const debugStatus = () => adminFetch('/admin/debugStatus', { method: 'POST' })
export const revokeAll = () => adminFetch('/admin/revokeAll', { method: 'POST' })
