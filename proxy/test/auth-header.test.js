
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Auth Header Authentication', () => {
  const validSessionId = 'valid-session-12345678-header' // Must match regex length (20+)
  const cookieSessionId = 'valid-session-12345678-cookie'
  
  beforeEach(async () => {
    // Clear KV
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }

    // Setup valid session for header
    await env.EEN_OAUTH_SESSIONS.put(
      validSessionId,
      JSON.stringify({
        refreshToken: 'refresh-token-header',
        userEmail: 'header@example.com',
        createdAt: Date.now()
      })
    )
  })

  it('should authenticate with valid Bearer token', async () => {
    // We expect this to attempt the upstream fetch and fail there, 
    // rather than failing at the session check (401).
    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: `Bearer ${validSessionId}`
      }
    })

    const data = await response.json()
    // "Token refresh failed" means it accepted the session ID, found it in KV, 
    // and attempted to refresh with EEN (which failed in test env).
    // "No session found" or "Session expired" would mean it failed to read/validate session.
    expect(data.error).toBe('Token refresh failed')
  })

  it('should reject invalid Bearer token format', async () => {
    // Too short (regex requires 20+)
    const shortToken = 'short'
    
    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: `Bearer ${shortToken}`
      }
    })

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toContain('No session')
  })

  it('should reject malformed Authorization header', async () => {
    // Missing 'Bearer ' prefix
    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: validSessionId
      }
    })

    expect(response.status).toBe(401)
  })

  it('should prioritize Authorization header over Cookie', async () => {
    // Header has VALID session
    // Cookie has INVALID session (not in KV)
    const invalidCookieSession = 'invalid-session-1234567890'

    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: `Bearer ${validSessionId}`,
        Cookie: `sessionId=${invalidCookieSession}`
      }
    })

    const data = await response.json()
    // Should use header (valid) -> 'Token refresh failed'
    // If it used cookie (invalid) -> 'Session expired or invalid'
    expect(data.error).toBe('Token refresh failed')
  })

  it('should fallback to Cookie if Authorization header is invalid', async () => {
    // Header has INVALID format (ignored)
    // Cookie has VALID session (in KV)
    
    // Setup valid cookie session
    await env.EEN_OAUTH_SESSIONS.put(
      cookieSessionId,
      JSON.stringify({
        refreshToken: 'refresh-token-cookie',
        userEmail: 'cookie@example.com',
        createdAt: Date.now()
      })
    )

    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: 'Bearer short', // Invalid format
        Cookie: `sessionId=${cookieSessionId}`
      }
    })

    const data = await response.json()
    // Should use cookie (valid) -> 'Token refresh failed'
    expect(data.error).toBe('Token refresh failed')
  })

  it('should reject extremely long Bearer token', async () => {
    const longToken = 'a'.repeat(100) // Limit is 50
    
    const response = await fetchWithMetrics('http://localhost/proxy/refreshAccessToken', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: `Bearer ${longToken}`
      }
    })

    expect(response.status).toBe(401)
  })
})
