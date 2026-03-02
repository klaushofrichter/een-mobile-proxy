/**
 * Admin service for proxy management
 *
 * All API calls use relative URLs since the admin SPA is served
 * from the same origin as the proxy (via Cloudflare Workers Static Assets).
 */

import { getAuthHeaders } from '../utils/auth-headers'

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

/**
 * Get proxy version
 */
export async function getVersion() {
  const headers = await getAuthHeaders()
  const response = await fetch('/admin/version', { headers })

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
  const response = await fetch('/admin/sessionsCount', { headers })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get session count' }))
    throw new Error(error.error || 'Failed to get session count')
  }

  return response.json()
}

/**
 * Get rate limit statistics
 */
export async function getRateLimitStats() {
  const headers = await getAuthHeaders()
  const response = await fetch('/admin/rateLimitStats', { headers })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get rate limit stats' }))
    throw new Error(error.error || 'Failed to get rate limit stats')
  }

  return response.json()
}

/**
 * Remove all sessions except current
 */
export async function removeSessions() {
  const headers = await getAuthHeaders()
  const response = await fetch('/admin/removeSessions', {
    method: 'DELETE',
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
  const response = await fetch('/admin/revokeAll', {
    method: 'POST',
    headers
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to revoke all tokens' }))
    throw new Error(error.error || 'Failed to revoke all tokens')
  }

  return response.json()
}
