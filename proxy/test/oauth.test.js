import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('OAuth endpoints', () => {
  beforeEach(async () => {
    // Clear KV storage before each test
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }
  })

  describe('POST /proxy/getAccessToken', () => {
    it('should return 400 if code is missing', async () => {
      const response = await fetchWithMetrics(
        'http://localhost/proxy/getAccessToken?redirect_uri=http://localhost:5173',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173'
          }
        }
      )

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Missing')
    })

    it('should return 400 if redirect_uri is missing', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken?code=test-code', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173'
        }
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Missing')
    })
  })

  describe('POST /proxy/refreshAccessToken', () => {
    it('should return 401 if no session cookie', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173'
        }
      })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toContain('No session')
    })

    it('should return 401 if session is invalid', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: 'sessionId=invalid-session-id-test-12345'
        }
      })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toContain('expired')
    })
  })

  describe('POST /proxy/revoke', () => {
    it('should return 401 if no session cookie', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/revoke', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173'
        }
      })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toContain('No session')
    })

    it('should succeed and clear cookie even if session not found', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/revoke', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: 'sessionId=non-existent-session-12345'
        }
      })

      // Should still succeed (idempotent operation)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.message).toContain('revoked')

      // Check cookie is cleared
      const setCookie = response.headers.get('Set-Cookie')
      expect(setCookie).toContain('Max-Age=0')
    })
  })
})
