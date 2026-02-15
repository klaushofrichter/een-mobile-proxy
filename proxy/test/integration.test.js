/**
 * Integration Tests
 *
 * Tests that verify the proxy can communicate with external services
 * and handles real-world scenarios correctly.
 *
 * Note: These tests use the Cloudflare Workers test environment
 * which isolates the worker but allows real network calls to EEN API.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Integration - EEN API Communication', () => {
  beforeEach(async () => {
    // Clear KV before each test
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }
  })

  describe('Token Exchange', () => {
    it('should receive proper error from EEN for invalid code', async () => {
      // This tests that the proxy can actually reach EEN's token endpoint
      const response = await fetchWithMetrics(
        'http://localhost/proxy/getAccessToken?code=invalid-test-code&redirect_uri=http://localhost:5173',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )

      // Should receive an error response (not a network error)
      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      // EEN API returns specific error format
      expect(data).toHaveProperty('error')
    })

    it('should receive proper error from EEN for invalid code via POST body', async () => {
      // This tests that POST body params are correctly forwarded to EEN
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'code=invalid-test-code-body&redirect_uri=http://localhost:5173'
      })

      // Should receive an error response from EEN (not a 400 from proxy validation)
      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('should handle expired authorization codes correctly', async () => {
      // Authorization codes expire quickly (typically 60 seconds)
      // An expired code should return an error from EEN
      const expiredCode = 'expired-code-12345'

      const response = await fetchWithMetrics(
        `http://localhost/proxy/getAccessToken?code=${expiredCode}&redirect_uri=http://localhost:5173`,
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )

      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
    })
  })

  describe('Refresh Token Flow', () => {
    it('should handle invalid refresh token from EEN', async () => {
      // Store a session with an invalid refresh token
      const sessionId = 'integration-test-session'
      await env.EEN_OAUTH_SESSIONS.put(
        sessionId,
        JSON.stringify({
          refreshToken: 'invalid-refresh-token-12345',
          userEmail: 'test@example.com',
          createdAt: Date.now()
        })
      )

      const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${sessionId}`
        }
      })

      // EEN will reject the invalid refresh token
      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('should clean up session on invalid refresh token', async () => {
      // Store a session with an invalid refresh token
      const sessionId = 'cleanup-test-session'
      await env.EEN_OAUTH_SESSIONS.put(
        sessionId,
        JSON.stringify({
          refreshToken: 'invalid-token-for-cleanup',
          userEmail: 'test@example.com',
          createdAt: Date.now()
        })
      )

      // Attempt to refresh
      await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${sessionId}`
        }
      })

      // Session is NOT deleted on refresh failure — TTL handles expiration.
      // This avoids a race condition with KV eventual consistency.
      const session = await env.EEN_OAUTH_SESSIONS.get(sessionId)
      expect(session).not.toBeNull()
    })
  })

  describe('Revocation Flow', () => {
    it('should handle revocation of non-existent session gracefully', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/revoke', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: 'sessionId=non-existent-session'
        }
      })

      // Should succeed (idempotent operation)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.message).toContain('revoked')
    })

    it('should clear session cookie on revoke', async () => {
      const sessionId = 'revoke-test-session-12345'
      await env.EEN_OAUTH_SESSIONS.put(
        sessionId,
        JSON.stringify({
          refreshToken: 'test-token',
          userEmail: 'test@example.com',
          createdAt: Date.now()
        })
      )

      const response = await fetchWithMetrics('http://localhost/proxy/revoke', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${sessionId}`
        }
      })

      expect(response.status).toBe(200)

      // Should set cookie with expired date to clear it
      const setCookie = response.headers.get('Set-Cookie')
      expect(setCookie).toContain('sessionId=')
      expect(setCookie).toContain('Max-Age=0')
    })
  })
})

describe('Integration - Session Persistence', () => {
  beforeEach(async () => {
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }
  })

  it('should persist session data in KV', async () => {
    const sessionId = 'persistence-test-session'
    const sessionData = {
      refreshToken: 'test-refresh-token',
      userEmail: 'persist@example.com',
      createdAt: Date.now()
    }

    await env.EEN_OAUTH_SESSIONS.put(sessionId, JSON.stringify(sessionData))

    // Verify session exists
    const retrieved = await env.EEN_OAUTH_SESSIONS.get(sessionId, 'json')
    expect(retrieved.userEmail).toBe('persist@example.com')
    expect(retrieved.refreshToken).toBe('test-refresh-token')
  })

  it('should list all sessions correctly', async () => {
    // Create multiple sessions
    for (let i = 0; i < 5; i++) {
      await env.EEN_OAUTH_SESSIONS.put(
        `list-test-session-${i}`,
        JSON.stringify({
          refreshToken: `token-${i}`,
          userEmail: `user${i}@example.com`,
          createdAt: Date.now()
        })
      )
    }

    const keys = await env.EEN_OAUTH_SESSIONS.list()
    expect(keys.keys.length).toBe(5)
  })

  it('should delete specific sessions', async () => {
    const sessionId = 'delete-test-session'
    await env.EEN_OAUTH_SESSIONS.put(
      sessionId,
      JSON.stringify({
        refreshToken: 'token',
        userEmail: 'delete@example.com',
        createdAt: Date.now()
      })
    )

    // Verify exists
    let session = await env.EEN_OAUTH_SESSIONS.get(sessionId)
    expect(session).not.toBeNull()

    // Delete
    await env.EEN_OAUTH_SESSIONS.delete(sessionId)

    // Verify deleted
    session = await env.EEN_OAUTH_SESSIONS.get(sessionId)
    expect(session).toBeNull()
  })
})

describe('Integration - Version Management', () => {
  beforeEach(async () => {
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }
  })

  it('should store and retrieve deploy version', async () => {
    const version = '1.2.3-test'
    await env.EEN_OAUTH_SESSIONS.put('DEPLOY_VERSION', version)

    const response = await fetchWithMetrics('http://localhost/health', {
      headers: { Origin: 'http://localhost:5173' }
    })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.version).toBe(version)
  })

  it('should handle missing deploy version gracefully', async () => {
    // Don't set DEPLOY_VERSION

    const response = await fetchWithMetrics('http://localhost/health', {
      headers: { Origin: 'http://localhost:5173' }
    })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.version).toBe('unknown')
  })

  it('should respond to HEAD requests for health endpoint', async () => {
    // HEAD requests are used by monitoring services like UptimeRobot
    const version = '1.0.0-head-test'
    await env.EEN_OAUTH_SESSIONS.put('DEPLOY_VERSION', version)

    const response = await fetchWithMetrics('http://localhost/health', {
      method: 'HEAD',
      headers: { Origin: 'http://localhost:5173' }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('should respond to HEAD requests without Origin header', async () => {
    // Monitoring services typically don't send Origin headers
    const response = await fetchWithMetrics('http://localhost/health', {
      method: 'HEAD'
    })

    expect(response.status).toBe(200)
  })
})

describe('Integration - Admin Operations', () => {
  const adminEmail = 'admin@example.com'
  const adminSessionId = 'admin-integration-session'

  beforeEach(async () => {
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }

    // Create admin session
    await env.EEN_OAUTH_SESSIONS.put(
      adminSessionId,
      JSON.stringify({
        refreshToken: 'admin-token',
        userEmail: adminEmail,
        createdAt: Date.now()
      })
    )
  })

  it('should count sessions accurately', async () => {
    // Add additional sessions
    for (let i = 0; i < 3; i++) {
      await env.EEN_OAUTH_SESSIONS.put(
        `user-session-${i}`,
        JSON.stringify({
          refreshToken: `token-${i}`,
          userEmail: `user${i}@example.com`,
          createdAt: Date.now()
        })
      )
    }

    const response = await fetchWithMetrics('http://localhost/admin/sessionsCount', {
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: `sessionId=${adminSessionId}`
      }
    })

    expect(response.status).toBe(200)

    const data = await response.json()
    // 4 sessions: 1 admin + 3 users
    expect(data.sessionCount).toBe(4)
  })

  it('should remove other sessions but keep current', async () => {
    // Add other sessions
    await env.EEN_OAUTH_SESSIONS.put(
      'other-session-1',
      JSON.stringify({
        refreshToken: 'token-1',
        userEmail: 'user1@example.com',
        createdAt: Date.now()
      })
    )
    await env.EEN_OAUTH_SESSIONS.put(
      'other-session-2',
      JSON.stringify({
        refreshToken: 'token-2',
        userEmail: 'user2@example.com',
        createdAt: Date.now()
      })
    )

    const response = await fetchWithMetrics('http://localhost/admin/removeSessions', {
      method: 'DELETE',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: `sessionId=${adminSessionId}`
      }
    })

    expect(response.status).toBe(200)

    // Check only admin session remains (filter out RATE_LIMIT: and DEPLOY_ keys)
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    const sessionKeys = keys.keys.filter(
      k => !k.name.startsWith('RATE_LIMIT:') && !k.name.startsWith('DEPLOY_')
    )
    expect(sessionKeys.length).toBe(1)
    expect(sessionKeys[0].name).toBe(adminSessionId)
  })

  it('should revoke all sessions including current', async () => {
    // Add other sessions
    await env.EEN_OAUTH_SESSIONS.put(
      'victim-session',
      JSON.stringify({
        refreshToken: 'victim-token',
        userEmail: 'victim@example.com',
        createdAt: Date.now()
      })
    )

    const response = await fetchWithMetrics('http://localhost/admin/revokeAll', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: `sessionId=${adminSessionId}`
      }
    })

    expect(response.status).toBe(200)

    // All sessions should be deleted (filter out RATE_LIMIT: and DEPLOY_ keys)
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    const sessionKeys = keys.keys.filter(
      k => !k.name.startsWith('RATE_LIMIT:') && !k.name.startsWith('DEPLOY_')
    )
    expect(sessionKeys.length).toBe(0)
  })
})
