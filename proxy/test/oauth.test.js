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

  describe('POST body parameters', () => {
    it('should accept code and redirect_uri from POST body', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'code=test-code&redirect_uri=http://localhost:5173'
      })

      // Should not be 400 (missing params) - may fail at EEN for invalid code
      expect(response.status).not.toBe(400)
    })

    it('should return 400 if code is missing from both body and query', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'redirect_uri=http://localhost:5173'
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Missing')
    })

    it('should return 400 if redirect_uri is missing from both body and query', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'code=test-code'
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Missing')
    })

    it('should prioritize body params over query params', async () => {
      // Body has valid redirect_uri, query has evil.com
      const response = await fetchWithMetrics(
        'http://localhost/proxy/getAccessToken?code=query-code&redirect_uri=https://evil.com/callback',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'code=body-code&redirect_uri=http://localhost:5173'
        }
      )

      // Should NOT be 400 for domain validation - body's valid URI takes priority
      expect(response.status).not.toBe(400)
    })

    it('should accept Content-Type with charset parameter', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        },
        body: 'code=test-code&redirect_uri=http://localhost:5173'
      })

      // Should not be 400 (missing params) - charset is valid Content-Type parameter
      expect(response.status).not.toBe(400)
    })

    it('should fall back to query string when no Content-Type header set', async () => {
      const response = await fetchWithMetrics(
        'http://localhost/proxy/getAccessToken?code=test-code&redirect_uri=http://localhost:5173',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173'
          }
        }
      )

      // Should not be 400 (missing params) - falls back to query string
      expect(response.status).not.toBe(400)
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
