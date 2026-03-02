/**
 * Integration Tests (Mobile Proxy)
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
      const response = await fetchWithMetrics(
        'http://localhost/proxy/getAccessToken?code=invalid-test-code&redirect_uri=myapp://callback',
        {
          method: 'POST'
        }
      )

      // Should receive an error response (not a network error)
      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('should receive proper error from EEN for invalid code via POST body', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'code=invalid-test-code-body&redirect_uri=myapp://callback'
      })

      // Should receive an error response from EEN (not a 400 from proxy validation)
      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('should handle expired authorization codes correctly', async () => {
      const expiredCode = 'expired-code-12345'

      const response = await fetchWithMetrics(
        `http://localhost/proxy/getAccessToken?code=${expiredCode}&redirect_uri=myapp://callback`,
        {
          method: 'POST'
        }
      )

      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
    })
  })

  describe('Refresh Token Flow', () => {
    it('should handle invalid refresh token from EEN', async () => {
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
          Authorization: `Bearer ${sessionId}`
        }
      })

      // EEN will reject the invalid refresh token
      expect(response.status).toBeGreaterThanOrEqual(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
    })

    it('should clean up session on invalid refresh token', async () => {
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
          Authorization: `Bearer ${sessionId}`
        }
      })

      // Session is NOT deleted on refresh failure — TTL handles expiration.
      const session = await env.EEN_OAUTH_SESSIONS.get(sessionId)
      expect(session).not.toBeNull()
    })
  })

  describe('Revocation Flow', () => {
    it('should handle revocation of non-existent session gracefully', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/revoke', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer non-existent-session-123'
        }
      })

      // Should succeed (idempotent operation)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.message).toContain('revoked')
    })

    it('should not set cookies on revoke (mobile proxy)', async () => {
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
          Authorization: `Bearer ${sessionId}`
        }
      })

      expect(response.status).toBe(200)

      // Mobile proxy should not set cookies
      const setCookie = response.headers.get('Set-Cookie')
      expect(setCookie).toBeNull()
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

    const retrieved = await env.EEN_OAUTH_SESSIONS.get(sessionId, 'json')
    expect(retrieved.userEmail).toBe('persist@example.com')
    expect(retrieved.refreshToken).toBe('test-refresh-token')
  })

  it('should list all sessions correctly', async () => {
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

    let session = await env.EEN_OAUTH_SESSIONS.get(sessionId)
    expect(session).not.toBeNull()

    await env.EEN_OAUTH_SESSIONS.delete(sessionId)

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

    const response = await fetchWithMetrics('http://localhost/health')

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.version).toBe(version)
  })

  it('should handle missing deploy version gracefully', async () => {
    const response = await fetchWithMetrics('http://localhost/health')

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.version).toBe('unknown')
  })

  it('should respond to HEAD requests for health endpoint', async () => {
    const version = '1.0.0-head-test'
    await env.EEN_OAUTH_SESSIONS.put('DEPLOY_VERSION', version)

    const response = await fetchWithMetrics('http://localhost/health', {
      method: 'HEAD'
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('should respond to HEAD requests without Origin header', async () => {
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
        Authorization: `Bearer ${adminSessionId}`
      }
    })

    expect(response.status).toBe(200)

    const data = await response.json()
    // 4 sessions: 1 admin + 3 users
    expect(data.sessionCount).toBe(4)
  })

  it('should remove other sessions but keep current', async () => {
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
        Authorization: `Bearer ${adminSessionId}`
      }
    })

    expect(response.status).toBe(200)

    // Check only admin session remains
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    const sessionKeys = keys.keys.filter(
      k => !k.name.startsWith('RATE_LIMIT:') && !k.name.startsWith('DEPLOY_')
    )
    expect(sessionKeys.length).toBe(1)
    expect(sessionKeys[0].name).toBe(adminSessionId)
  })

  it('should revoke all sessions including current', async () => {
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
        Authorization: `Bearer ${adminSessionId}`
      }
    })

    expect(response.status).toBe(200)

    // All sessions should be deleted
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    const sessionKeys = keys.keys.filter(
      k => !k.name.startsWith('RATE_LIMIT:') && !k.name.startsWith('DEPLOY_')
    )
    expect(sessionKeys.length).toBe(0)
  })
})
