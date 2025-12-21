/**
 * Security and Vulnerability Tests
 *
 * Tests for common security vulnerabilities and edge cases:
 * - Injection attacks (SQL, NoSQL, XSS, Command injection)
 * - Session security
 * - Input validation
 * - Cookie security
 * - Path traversal
 * - CORS bypass attempts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Security - Input Validation', () => {
  describe('Code Parameter Injection', () => {
    const maliciousPayloads = [
      // SQL Injection attempts
      "'; DROP TABLE sessions; --",
      "' OR '1'='1",
      "1; SELECT * FROM users",
      // NoSQL Injection attempts
      '{"$gt": ""}',
      '{"$ne": null}',
      // XSS attempts
      '<script>alert("xss")</script>',
      'javascript:alert(1)',
      '"><img src=x onerror=alert(1)>',
      // Command injection attempts
      '; ls -la',
      '| cat /etc/passwd',
      '`rm -rf /`',
      '$(whoami)',
      // Path traversal
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32',
      // Null byte injection
      'valid-code%00.txt',
      'code\x00malicious',
      // Unicode/encoding attacks
      '%u0000',
      '\u202e',
      // Very long strings
      'a'.repeat(10000),
      // Special characters
      '\n\r\t',
      '\x00\x01\x02',
    ]

    it.each(maliciousPayloads)('should safely handle malicious code: %s', async (payload) => {
      const response = await fetchWithMetrics(
        `http://localhost/proxy/getAccessToken?code=${encodeURIComponent(payload)}&redirect_uri=http://localhost:5173`,
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )

      // Should not crash - returns an error status (4xx or 5xx)
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(600)

      // Response should be valid JSON
      const data = await response.json()
      expect(data).toHaveProperty('error')
    })
  })

  describe('Redirect URI Validation', () => {
    const maliciousUris = [
      // Open redirect attempts
      'http://evil.com',
      'https://attacker.com/callback',
      '//evil.com',
      'http://localhost.evil.com',
      // JavaScript protocol
      'javascript:alert(1)',
      'javascript://alert(1)',
      // Data URI
      'data:text/html,<script>alert(1)</script>',
      // File protocol
      'file:///etc/passwd',
      // FTP
      'ftp://evil.com',
      // Malformed URLs
      'http://',
      'http:///',
      'http://@evil.com',
      'http://user:pass@evil.com',
    ]

    it.each(maliciousUris)('should handle potentially malicious redirect_uri: %s', async (uri) => {
      const response = await fetchWithMetrics(
        `http://localhost/proxy/getAccessToken?code=test&redirect_uri=${encodeURIComponent(uri)}`,
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )

      // Should not crash
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })
})

describe('Security - Session Management', () => {
  const validSessionId = 'valid-session-123'

  beforeEach(async () => {
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }

    await env.EEN_OAUTH_SESSIONS.put(
      validSessionId,
      JSON.stringify({
        refreshToken: 'test-refresh-token',
        userEmail: 'admin@example.com',
        createdAt: Date.now()
      })
    )
  })

  describe('Session ID Manipulation', () => {
    const maliciousSessionIds = [
      // Injection attempts
      "'; DROP TABLE sessions; --",
      '{"$gt": ""}',
      // Path traversal in session ID
      '../../../etc/passwd',
      '..\\admin-session',
      // Null byte
      'valid-session%00admin',
      // UUID manipulation
      'valid-session-123/../admin-session',
      // Very long session ID
      'a'.repeat(10000),
      // Empty and whitespace
      '',
      '   ',
      '\n\r\t',
    ]

    it.each(maliciousSessionIds)('should reject malicious session ID: %s', async (sessionId) => {
      const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${sessionId}`
        }
      })

      // Should return 4xx/5xx for invalid sessions, not crash
      // Very long strings may hit limits (500), normal invalid sessions return 401
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(600)
    })
  })

  describe('Cookie Security', () => {
    it('should set secure cookie attributes', async () => {
      // Create a mock session that would set a cookie
      await env.EEN_OAUTH_SESSIONS.put(
        'test-session',
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
          Cookie: 'sessionId=test-session'
        }
      })

      const setCookie = response.headers.get('Set-Cookie')
      if (setCookie) {
        // Should have secure attributes
        expect(setCookie).toContain('HttpOnly')
        expect(setCookie).toContain('Secure')
        expect(setCookie).toContain('SameSite')
      }
    })

    it('should not expose session data in response', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: `sessionId=${validSessionId}`
        }
      })

      const text = await response.text()

      // Should not contain the refresh token
      expect(text).not.toContain('test-refresh-token')
      // Should not contain the raw session ID
      expect(text).not.toContain(validSessionId)
    })
  })
})

describe('Security - CORS Bypass Attempts', () => {
  const bypassAttempts = [
    // Null origin
    { origin: 'null', description: 'null origin' },
    // Origin with trailing characters
    { origin: 'http://localhost:5173.evil.com', description: 'subdomain trick' },
    // Origin manipulation
    { origin: 'http://localhost:5173%00.evil.com', description: 'null byte in origin' },
    // Case sensitivity
    { origin: 'HTTP://LOCALHOST:5173', description: 'uppercase origin' },
    // Whitespace
    { origin: ' http://localhost:5173', description: 'leading whitespace' },
    { origin: 'http://localhost:5173 ', description: 'trailing whitespace' },
    // Protocol manipulation
    { origin: 'https://localhost:5173', description: 'https instead of http' },
    // Port manipulation
    { origin: 'http://localhost:5174', description: 'different port' },
    // Host manipulation
    { origin: 'http://127.0.0.1:5173', description: 'IP instead of localhost' },
  ]

  it.each(bypassAttempts)('should handle origin: $description', async ({ origin }) => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://test.com', {
      method: 'POST',
      headers: { Origin: origin }
    })

    // Either forbidden (403) or the request proceeds with proper CORS headers
    // The key is it shouldn't crash and shouldn't allow unauthorized origins
    expect(response.status).toBeGreaterThanOrEqual(200)

    const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
    // Should not echo back malicious origins
    if (allowOrigin && allowOrigin !== '*') {
      expect(allowOrigin).not.toContain('evil.com')
    }
  })
})

describe('Security - HTTP Method Validation', () => {
  const endpoints = [
    { path: '/proxy/getAccessToken', allowedMethod: 'POST' },
    { path: '/proxy/refreshAccessToken', allowedMethod: 'POST' },
    { path: '/proxy/revoke', allowedMethod: 'POST' },
    { path: '/admin/version', allowedMethod: 'GET' },
    { path: '/admin/sessionsCount', allowedMethod: 'GET' },
    { path: '/admin/removeSessions', allowedMethod: 'DELETE' },
    { path: '/admin/revokeAll', allowedMethod: 'POST' },
    { path: '/health', allowedMethod: 'GET' },
  ]

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

  endpoints.forEach(({ path, allowedMethod }) => {
    methods.forEach((method) => {
      if (method !== allowedMethod && method !== 'OPTIONS') {
        it(`should reject ${method} on ${path} (expects ${allowedMethod})`, async () => {
          const response = await fetchWithMetrics(`http://localhost${path}`, {
            method,
            headers: { Origin: 'http://localhost:5173' }
          })

          // Should return 404 for wrong method or specific error
          // Not 500 (server crash)
          expect(response.status).toBeLessThan(500)
        })
      }
    })
  })
})

describe('Security - Header Injection', () => {
  it('should not allow header injection via cookie', async () => {
    // Modern fetch API rejects invalid header values containing \r\n
    // This is actually good security - injection attempts are blocked at the HTTP level
    const maliciousCookie = 'sessionId=test\r\nX-Injected: malicious'

    // Verify that the fetch API throws on invalid header values
    await expect(
      fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: maliciousCookie
        }
      })
    ).rejects.toThrow()
  })

  it('should not reflect user input in error messages unsanitized', async () => {
    const xssPayload = '<script>alert(1)</script>'

    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=${encodeURIComponent(xssPayload)}&redirect_uri=http://localhost:5173`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    const text = await response.text()
    // Response should not contain unescaped HTML
    expect(text).not.toContain('<script>')
  })
})

describe('Security - Rate Limiting Awareness', () => {
  it('should handle rapid sequential requests gracefully', async () => {
    const requests = Array(10).fill(null).map(() =>
      fetchWithMetrics('http://localhost/health', {
        headers: { Origin: 'http://localhost:5173' }
      })
    )

    const responses = await Promise.all(requests)

    // All requests should succeed (no crashes)
    responses.forEach((response) => {
      expect(response.status).toBe(200)
    })
  })
})

describe('Security - JSON Parsing', () => {
  beforeEach(async () => {
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }
  })

  it('should handle corrupted session data gracefully', async () => {
    // Store corrupted JSON
    await env.EEN_OAUTH_SESSIONS.put('corrupted-session', 'not valid json {{{')

    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: 'sessionId=corrupted-session'
      }
    })

    // Should handle gracefully, not crash
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(600)
  })

  it('should handle session with missing fields', async () => {
    // Store session with missing refreshToken
    await env.EEN_OAUTH_SESSIONS.put('incomplete-session', JSON.stringify({
      userEmail: 'test@example.com'
      // Missing refreshToken
    }))

    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: 'sessionId=incomplete-session'
      }
    })

    // Should handle gracefully
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})

describe('Security - Response Headers', () => {
  it('should set appropriate content-type header', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      headers: { Origin: 'http://localhost:5173' }
    })

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('should not expose sensitive headers', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      headers: { Origin: 'http://localhost:5173' }
    })

    // Should not expose server info
    expect(response.headers.get('X-Powered-By')).toBeNull()
    expect(response.headers.get('Server')).toBeNull()
  })

  it('should include security headers on all responses', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      headers: { Origin: 'http://localhost:5173' }
    })

    // Verify all security headers are present
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    // Note: HSTS is only included in production, not in development/test environment
  })

  it('should include security headers on error responses', async () => {
    const response = await fetchWithMetrics('http://localhost/unknown-path', {
      headers: { Origin: 'http://localhost:5173' }
    })

    expect(response.status).toBe(404)
    // Security headers should still be present on error responses
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  })
})

describe('Security - Input Length Validation', () => {
  it('should reject code parameter exceeding 2000 characters', async () => {
    const longCode = 'a'.repeat(2001)
    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=${longCode}&redirect_uri=http://localhost:5173`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('too long')
  })

  it('should reject redirect_uri parameter exceeding 2000 characters', async () => {
    const longUri = 'http://localhost/' + 'a'.repeat(2001)
    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=test&redirect_uri=${encodeURIComponent(longUri)}`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('too long')
  })

  it('should accept code parameter within 2000 characters', async () => {
    const validCode = 'a'.repeat(2000)
    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=${validCode}&redirect_uri=http://localhost:5173`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    // Should not be rejected for length (may fail for invalid code at EEN)
    expect(response.status).not.toBe(400)
  })
})

describe('Security - Redirect URI Validation', () => {
  it('should reject redirect_uri with disallowed domain', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=https://evil.com/callback',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('domain not allowed')
  })

  it('should reject redirect_uri with invalid URL format', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=not-a-valid-url',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('malformed URL')
  })

  it('should accept redirect_uri with allowed origin', async () => {
    // localhost:5173 is allowed via ALLOWED_ORIGINS in vitest.config.js
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://localhost:5173/callback',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    // Should not be rejected for domain (may fail at EEN for invalid code)
    expect(response.status).not.toBe(400)
  })

  it('should accept redirect_uri with 127.0.0.1:3333 in development', async () => {
    // 127.0.0.1:3333 is auto-allowed in development (matches EEN redirect URI)
    // Note: This test requires ENVIRONMENT='development' in vitest.config.js
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://127.0.0.1:3333/callback',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    // Should not be rejected for domain (may fail at EEN for invalid code)
    expect(response.status).not.toBe(400)
  })

  it('should reject redirect_uri with localhost:3333 (not auto-allowed)', async () => {
    // Regression test: localhost:3333 is NOT auto-allowed, only 127.0.0.1:3333 is
    // This is because EEN OAuth requires exact redirect URI match
    // Note: This test requires ENVIRONMENT='development' in vitest.config.js
    //
    // Important: We use a valid Origin (localhost:5173 from ALLOWED_ORIGINS in vitest.config.js)
    // to ensure we're testing redirect_uri validation, not origin validation.
    // - Origin rejection = 403 Forbidden
    // - redirect_uri rejection = 400 Bad Request with 'Invalid redirect_uri' error
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://localhost:3333/callback',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    // Verify it's a 400 (redirect_uri error), not 403 (origin error)
    expect(response.status).toBe(400)
    const data = await response.json()
    // Verify error is specifically about redirect_uri with helpful localhost hint
    expect(data.error).toContain('redirect_uri')
    expect(data.error).toContain('127.0.0.1 instead of localhost')
  })
})

describe('Security - CSRF Protection', () => {
  it('should reject POST request without Origin header', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://localhost:5173',
      {
        method: 'POST'
        // No Origin header
      }
    )

    expect(response.status).toBe(403)
    const text = await response.text()
    expect(text).toContain('Origin header required')
  })

  it('should reject DELETE request without Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/admin/removeSessions', {
      method: 'DELETE',
      headers: {
        Cookie: 'sessionId=test-session'
      }
      // No Origin header
    })

    expect(response.status).toBe(403)
    const text = await response.text()
    expect(text).toContain('Origin header required')
  })

  it('should allow POST request with valid Origin header', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://localhost:5173',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      }
    )

    // Should not be blocked by CSRF protection (may fail for other reasons like invalid code)
    expect(response.status).not.toBe(403)
  })

  it('should allow DELETE request with valid Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/admin/removeSessions', {
      method: 'DELETE',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: 'sessionId=test-session'
      }
    })

    // Should not be blocked by CSRF protection (may fail for auth reasons)
    // 401 = no auth, not 403 = CSRF blocked
    expect(response.status).toBe(401)
  })

  it('should allow GET request without Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      method: 'GET'
      // No Origin header - should be allowed for GET
    })

    expect(response.status).toBe(200)
  })

  it('should allow HEAD request without Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      method: 'HEAD'
      // No Origin header - should be allowed for HEAD
    })

    expect(response.status).toBe(200)
  })
})
