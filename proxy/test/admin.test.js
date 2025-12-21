import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Admin endpoints', () => {
  const adminSessionId = 'admin-session-id-test-123'
  const regularSessionId = 'regular-session-id-test-456'

  beforeEach(async () => {
    // Clear KV storage before each test
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }

    // Create admin session
    await env.EEN_OAUTH_SESSIONS.put(
      adminSessionId,
      JSON.stringify({
        refreshToken: 'admin-refresh-token',
        userEmail: 'admin@example.com',
        createdAt: Date.now()
      })
    )

    // Create regular user session
    await env.EEN_OAUTH_SESSIONS.put(
      regularSessionId,
      JSON.stringify({
        refreshToken: 'regular-refresh-token',
        userEmail: 'user@example.com',
        createdAt: Date.now()
      })
    )

    // Set deploy version
    await env.EEN_OAUTH_SESSIONS.put('DEPLOY_VERSION', 'test-version-1.0.0')
  })

  describe('GET /admin/version', () => {
    it('should return 401 if not authenticated', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/version', {
        headers: {
          Origin: 'http://localhost:5173'
        }
      })

      expect(response.status).toBe(401)
    })

    it('should return 403 if not admin', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/version', {
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${regularSessionId}`
        }
      })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toContain('Admin')
    })

    it('should return version for admin users', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/version', {
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${adminSessionId}`
        }
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.version).toBe('test-version-1.0.0')
    })
  })

  describe('GET /admin/sessionsCount', () => {
    it('should return 401 if not authenticated', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/sessionsCount', {
        headers: {
          Origin: 'http://localhost:5173'
        }
      })

      expect(response.status).toBe(401)
    })

    it('should return session count for admin users', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/sessionsCount', {
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${adminSessionId}`
        }
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      // Should count admin + regular sessions, not DEPLOY_VERSION
      expect(data.sessionCount).toBe(2)
    })
  })

  describe('DELETE /admin/removeSessions', () => {
    it('should return 403 if not admin', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/removeSessions', {
        method: 'DELETE',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${regularSessionId}`
        }
      })

      expect(response.status).toBe(403)
    })

    it('should remove other sessions but keep current', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/removeSessions', {
        method: 'DELETE',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${adminSessionId}`
        }
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.deletedSessions).toBe(1)
      expect(data.remainingSessions).toBe(1)

      // Verify admin session still exists
      const adminSession = await env.EEN_OAUTH_SESSIONS.get(adminSessionId)
      expect(adminSession).not.toBeNull()

      // Verify regular session is deleted
      const regularSession = await env.EEN_OAUTH_SESSIONS.get(regularSessionId)
      expect(regularSession).toBeNull()

      // Verify DEPLOY_VERSION still exists
      const version = await env.EEN_OAUTH_SESSIONS.get('DEPLOY_VERSION')
      expect(version).toBe('test-version-1.0.0')
    })
  })

  describe('POST /admin/revokeAll', () => {
    it('should return 403 if not admin', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/revokeAll', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${regularSessionId}`
        }
      })

      expect(response.status).toBe(403)
    })

    it('should revoke all sessions including current', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/revokeAll', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${adminSessionId}`
        }
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.revokedSessions).toBe(2)

      // Verify cookie is cleared
      const setCookie = response.headers.get('Set-Cookie')
      expect(setCookie).toContain('Max-Age=0')

      // Verify all sessions are deleted
      const adminSession = await env.EEN_OAUTH_SESSIONS.get(adminSessionId)
      expect(adminSession).toBeNull()

      const regularSession = await env.EEN_OAUTH_SESSIONS.get(regularSessionId)
      expect(regularSession).toBeNull()

      // Verify DEPLOY_VERSION still exists
      const version = await env.EEN_OAUTH_SESSIONS.get('DEPLOY_VERSION')
      expect(version).toBe('test-version-1.0.0')
    })
  })
})
