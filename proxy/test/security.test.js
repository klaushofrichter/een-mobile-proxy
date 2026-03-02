/**
 * Security and Vulnerability Tests (Mobile Proxy)
 *
 * Tests for common security vulnerabilities and edge cases:
 * - Injection attacks (SQL, NoSQL, XSS, Command injection)
 * - Session security (Bearer token only)
 * - Input validation
 * - Path traversal
 * - Redirect URI scheme validation
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
        `http://localhost/proxy/getAccessToken?code=${encodeURIComponent(payload)}&redirect_uri=myapp://callback`,
        {
          method: 'POST'
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
          method: 'POST'
        }
      )

      // Should not crash
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })
})

describe('Security - Session Management', () => {
  const validSessionId = 'valid-session-12345678901'

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

  describe('Session ID Manipulation via Bearer Token', () => {
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
          Authorization: `Bearer ${sessionId}`
        }
      })

      // Should return 4xx for invalid sessions, not crash
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(600)
    })
  })

  describe('Bearer Token Security', () => {
    it('should not expose session data in response', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validSessionId}`
        }
      })

      const text = await response.text()

      // Should not contain the refresh token
      expect(text).not.toContain('test-refresh-token')
      // Should not contain the raw session ID
      expect(text).not.toContain(validSessionId)
    })

    it('should not set any cookies (Bearer only)', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validSessionId}`
        }
      })

      const setCookie = response.headers.get('Set-Cookie')
      expect(setCookie).toBeNull()
    })
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
            method
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
  it('should not allow header injection via Authorization', async () => {
    const maliciousAuth = 'Bearer test\r\nX-Injected: malicious'

    await expect(
      fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
        method: 'POST',
        headers: {
          Authorization: maliciousAuth
        }
      })
    ).rejects.toThrow()
  })

  it('should not reflect user input in error messages unsanitized', async () => {
    const xssPayload = '<script>alert(1)</script>'

    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=${encodeURIComponent(xssPayload)}&redirect_uri=myapp://callback`,
      {
        method: 'POST'
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
      fetchWithMetrics('http://localhost/health')
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
    await env.EEN_OAUTH_SESSIONS.put('corrupted-session-12345678', 'not valid json {{{')

    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer corrupted-session-12345678'
      }
    })

    // Should handle gracefully, not crash
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(600)
  })

  it('should handle session with missing fields', async () => {
    // Store session with missing refreshToken
    await env.EEN_OAUTH_SESSIONS.put('incomplete-session-1234567', JSON.stringify({
      userEmail: 'test@example.com'
      // Missing refreshToken
    }))

    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer incomplete-session-1234567'
      }
    })

    // Should handle gracefully
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})

describe('Security - Response Headers', () => {
  it('should set appropriate content-type header', async () => {
    const response = await fetchWithMetrics('http://localhost/health')

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('should not expose sensitive headers', async () => {
    const response = await fetchWithMetrics('http://localhost/health')

    // Should not expose server info
    expect(response.headers.get('X-Powered-By')).toBeNull()
    expect(response.headers.get('Server')).toBeNull()
  })

  it('should not include browser-specific security headers (mobile proxy)', async () => {
    const response = await fetchWithMetrics('http://localhost/health')

    // Mobile proxy should not include browser-specific headers
    expect(response.headers.get('X-Frame-Options')).toBeNull()
    expect(response.headers.get('Content-Security-Policy')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('should include Cache-Control: no-store on token exchange responses (RFC 6749)', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'code=test-code&redirect_uri=myapp://callback'
    })

    // Response should include cache prevention headers per RFC 6749 Section 5.1
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Pragma')).toBe('no-cache')
  })

  it('should include Cache-Control: no-store on token refresh responses (RFC 6749)', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid-session-id-test-12345'
      }
    })

    expect(response.status).toBe(401)
    // Even error responses from token endpoints should not be cached
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Pragma')).toBe('no-cache')
  })
})

describe('Security - Input Length Validation', () => {
  it('should reject code parameter exceeding 2000 characters', async () => {
    const longCode = 'a'.repeat(2001)
    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=${longCode}&redirect_uri=myapp://callback`,
      {
        method: 'POST'
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('too long')
  })

  it('should reject redirect_uri parameter exceeding 2000 characters', async () => {
    const longUri = 'myapp://callback/' + 'a'.repeat(2001)
    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=test&redirect_uri=${encodeURIComponent(longUri)}`,
      {
        method: 'POST'
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('too long')
  })

  it('should accept code parameter within 2000 characters', async () => {
    const validCode = 'a'.repeat(2000)
    const response = await fetchWithMetrics(
      `http://localhost/proxy/getAccessToken?code=${validCode}&redirect_uri=myapp://callback`,
      {
        method: 'POST'
      }
    )

    // Should not be rejected for length (may fail for invalid code at EEN)
    expect(response.status).not.toBe(400)
  })
})

describe('Security - Redirect URI Scheme Validation', () => {
  it('should reject redirect_uri with disallowed scheme', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=https://evil.com/callback',
      {
        method: 'POST'
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('not allowed')
  })

  it('should reject redirect_uri with invalid URL format', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=not-a-valid-url',
      {
        method: 'POST'
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('malformed URL')
  })

  it('should accept redirect_uri with allowed scheme (myapp)', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=myapp://callback',
      {
        method: 'POST'
      }
    )

    // Should not be rejected for scheme (may fail at EEN for invalid code)
    expect(response.status).not.toBe(400)
  })

  it('should accept redirect_uri with allowed scheme (myotherapp)', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=myotherapp://auth/callback',
      {
        method: 'POST'
      }
    )

    // Should not be rejected for scheme (may fail at EEN for invalid code)
    expect(response.status).not.toBe(400)
  })

  it('should accept redirect_uri with http scheme in development', async () => {
    // http is auto-allowed in development mode
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://127.0.0.1:3333/callback',
      {
        method: 'POST'
      }
    )

    // Should not be rejected for scheme (may fail at EEN for invalid code)
    expect(response.status).not.toBe(400)
  })

  it('should reject redirect_uri with https scheme (not in ALLOWED_SCHEMES)', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=https://example.com/callback',
      {
        method: 'POST'
      }
    )

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('not allowed')
  })
})

describe('Security - POST Body Input Validation', () => {
  it('should reject code >2000 chars in POST body', async () => {
    const longCode = 'a'.repeat(2001)
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `code=${longCode}&redirect_uri=myapp://callback`
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('too long')
  })

  it('should reject redirect_uri >2000 chars in POST body', async () => {
    const longUri = 'myapp://callback/' + 'a'.repeat(2001)
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `code=test&redirect_uri=${encodeURIComponent(longUri)}`
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('too long')
  })

  it('should reject disallowed redirect_uri scheme in POST body', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'code=test&redirect_uri=https://evil.com/callback'
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('not allowed')
  })

  it('should reject POST body with Content-Length > 10000', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '10001'
      },
      body: 'code=test&redirect_uri=myapp://callback'
    })

    expect(response.status).toBe(413)
    const data = await response.json()
    expect(data.error).toContain('oversized')
  })

  it('should accept POST body with Content-Length exactly 10000', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '10000'
      },
      body: 'code=test&redirect_uri=myapp://callback'
    })

    // Should not be 413 - exactly at the limit is allowed
    expect(response.status).not.toBe(413)
  })

  it('should reject POST body with non-numeric Content-Length', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': 'garbage'
      },
      body: 'code=test&redirect_uri=myapp://callback'
    })

    expect(response.status).toBe(413)
    const data = await response.json()
    expect(data.error).toContain('Invalid')
  })

  it('should reject POST body with negative Content-Length', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '-100'
      },
      body: 'code=test&redirect_uri=myapp://callback'
    })

    expect(response.status).toBe(413)
    const data = await response.json()
    expect(data.error).toContain('Invalid')
  })

  it('should accept POST body with Content-Length of 0', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=myapp://callback',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': '0'
        },
        body: ''
      }
    )

    // Should not be 413 - Content-Length 0 is valid
    expect(response.status).not.toBe(413)
    expect(response.status).not.toBe(411)
  })

  it('should reject POST body with extremely large Content-Length string', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '99999999999999999999999'
      },
      body: 'code=test&redirect_uri=myapp://callback'
    })

    expect(response.status).toBe(413)
    const data = await response.json()
    expect(data.error).toContain('oversized')
  })

  it('should reject oversized actual body even with small Content-Length header', async () => {
    const largeBody = 'code=test&redirect_uri=' + 'x'.repeat(10001)
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '50'
      },
      body: largeBody
    })

    expect(response.status).toBe(413)
    const data = await response.json()
    expect(data.error).toContain('oversized')
  })

  it('should fall back to query params when POST body is malformed', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=myapp://callback',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: ''
      }
    )

    // Should not be 400 for missing params - falls back to query string
    expect(response.status).not.toBe(400)
  })
})

describe('Security - No CSRF for Mobile', () => {
  it('should allow POST request without Origin header', async () => {
    const response = await fetchWithMetrics(
      'http://localhost/proxy/getAccessToken?code=test&redirect_uri=myapp://callback',
      {
        method: 'POST'
        // No Origin header - mobile apps don't send Origin
      }
    )

    // Should not be 403 - mobile proxy doesn't require Origin
    expect(response.status).not.toBe(403)
  })

  it('should allow DELETE request without Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/admin/removeSessions', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer some-test-session-id-1234'
      }
      // No Origin header
    })

    // Should not be 403 - mobile proxy doesn't require Origin
    // 401 is expected (invalid session) but not 403
    expect(response.status).not.toBe(403)
  })

  it('should allow GET request without Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      method: 'GET'
    })

    expect(response.status).toBe(200)
  })

  it('should allow HEAD request without Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      method: 'HEAD'
    })

    expect(response.status).toBe(200)
  })
})
