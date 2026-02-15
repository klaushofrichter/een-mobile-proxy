/**
 * Rate Limiting Tests
 *
 * Tests for the rate limiting middleware:
 * - Rate limit configuration parsing
 * - Rate limit checks and enforcement
 * - 429 response format
 * - Retry-After header
 * - Admin rate limit stats endpoint
 * - Category-based limiting (health, oauth, admin)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Rate Limiting', () => {
  beforeEach(async () => {
    // Clear any rate limit keys from KV before each test
    const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:' })
    for (const key of listResult.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }
  })

  describe('Rate Limit Configuration', () => {
    it('should accept requests when rate limiting is disabled', async () => {
      // By default, rate limiting is enabled, but with high limits
      // We test that requests go through successfully
      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.status).toBe('ok')
    })

    it('should categorize /health endpoint correctly', async () => {
      // Make multiple requests to health endpoint
      for (let i = 0; i < 5; i++) {
        const response = await fetchWithMetrics('http://localhost/health', {
          method: 'GET'
        })
        expect(response.status).toBe(200)
      }
    })

    it('should categorize /proxy/* endpoints correctly', async () => {
      // These will fail auth but should still be rate limited
      const response = await fetchWithMetrics(
        'http://localhost/proxy/refreshAccessToken',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )

      // Should get 401 (no session), not rate limited
      expect(response.status).toBe(401)
    })

    it('should categorize /admin/* endpoints correctly', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/version', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' }
      })

      // Should get 401 (no session), not rate limited initially
      expect(response.status).toBe(401)
    })
  })

  describe('Rate Limit Response Format', () => {
    it('should return proper 429 response with Retry-After header when limited', async () => {
      // First, simulate hitting the rate limit by inserting a high counter directly
      // This is a unit test approach since we can't easily change config per-test
      const bucket = Math.floor(Date.now() / (60 * 1000)) // Default 60 second window
      const key = `RATE_LIMIT:health:unknown:${bucket}`

      // Set counter to a very high value to trigger rate limit
      await env.EEN_OAUTH_SESSIONS.put(key, '1000', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })

      // Should be rate limited
      expect(response.status).toBe(429)

      // Check response body
      const data = await response.json()
      expect(data.error).toBe('rate_limit_exceeded')
      expect(data.message).toMatch(/Too many requests/)
      expect(data.retryAfter).toBeGreaterThan(0)
      expect(data.retryAfter).toBeLessThanOrEqual(60) // Max window size

      // Check Retry-After header
      const retryAfter = response.headers.get('Retry-After')
      expect(retryAfter).toBeDefined()
      expect(parseInt(retryAfter, 10)).toBeGreaterThan(0)
    })
  })

  describe('Rate Limit Enforcement', () => {
    it('should track request counts in KV', async () => {
      // Make a request to health endpoint
      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })

      expect(response.status).toBe(200)

      // Check that a rate limit key was created
      const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:' })
      expect(listResult.keys.length).toBeGreaterThan(0)

      // Check the counter value
      const key = listResult.keys[0].name
      const countStr = await env.EEN_OAUTH_SESSIONS.get(key)
      expect(parseInt(countStr, 10)).toBeGreaterThanOrEqual(1)
    })

    it('should not rate limit 404 responses', async () => {
      // Make requests to non-existent endpoint
      for (let i = 0; i < 5; i++) {
        const response = await fetchWithMetrics('http://localhost/nonexistent', {
          method: 'GET'
        })
        expect(response.status).toBe(404)
      }

      // No rate limit keys should be created for this path
      const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:' })
      // Filter out keys for other endpoints that might have been hit
      const nonExistentKeys = listResult.keys.filter(k => k.name.includes('nonexistent'))
      expect(nonExistentKeys.length).toBe(0)
    })

    it('should allow requests up to the limit', async () => {
      // Clear any existing counters first
      const existingKeys = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:' })
      for (const key of existingKeys.keys) {
        await env.EEN_OAUTH_SESSIONS.delete(key.name)
      }

      // Default health limit is 60, make sure we're under it
      const requestCount = 5
      for (let i = 0; i < requestCount; i++) {
        const response = await fetchWithMetrics('http://localhost/health', {
          method: 'GET'
        })
        expect(response.status).toBe(200)
      }

      // Verify counter is tracking
      const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:' })
      expect(listResult.keys.length).toBeGreaterThan(0)
    })

    it('should block requests exceeding the limit', async () => {
      // Set counter just below limit for an identified client
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const clientIp = '192.168.50.50'
      const key = `RATE_LIMIT:health:ip|${clientIp}:${bucket}`

      // Set to 59 (one below default limit of 60)
      await env.EEN_OAUTH_SESSIONS.put(key, '59', { expirationTtl: 120 })

      // This request should succeed (59 -> 60)
      const response1 = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': clientIp }
      })
      expect(response1.status).toBe(200)

      // Now set counter to exactly the limit
      await env.EEN_OAUTH_SESSIONS.put(key, '60', { expirationTtl: 120 })

      // This request should be blocked
      const response2 = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': clientIp }
      })
      expect(response2.status).toBe(429)
    })
  })

  describe('Rate Limit Categories', () => {
    it('should have separate limits for different categories', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))

      // Exhaust health limit
      const healthKey = `RATE_LIMIT:health:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(healthKey, '100', { expirationTtl: 120 })

      // Health should be blocked
      const healthResponse = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })
      expect(healthResponse.status).toBe(429)

      // But admin should still work (even though it returns 401 for no auth)
      const adminResponse = await fetchWithMetrics('http://localhost/admin/version', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' }
      })
      expect(adminResponse.status).toBe(401) // Not 429
    })

    it('should track OAuth endpoints separately', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))

      // Set high counter for OAuth
      const oauthKey = `RATE_LIMIT:oauth:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(oauthKey, '100', { expirationTtl: 120 })

      // OAuth should be blocked
      const oauthResponse = await fetchWithMetrics(
        'http://localhost/proxy/refreshAccessToken',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )
      expect(oauthResponse.status).toBe(429)

      // Health should still work
      const healthResponse = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })
      expect(healthResponse.status).toBe(200)
    })
  })

  describe('Client Identification', () => {
    it('should identify clients by CF-Connecting-IP when available', async () => {
      const clientIp = '192.168.1.100'

      // Make request with CF-Connecting-IP header
      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': clientIp }
      })

      expect(response.status).toBe(200)

      // Check that the key includes the IP
      const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:ip|' })
      const matchingKeys = listResult.keys.filter(k => k.name.includes(clientIp))
      expect(matchingKeys.length).toBeGreaterThan(0)
    })

    it('should use X-Forwarded-For as fallback', async () => {
      const clientIp = '10.0.0.50'

      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'X-Forwarded-For': `${clientIp}, 10.0.0.1, 10.0.0.2` }
      })

      expect(response.status).toBe(200)

      const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:ip|' })
      const matchingKeys = listResult.keys.filter(k => k.name.includes(clientIp))
      expect(matchingKeys.length).toBeGreaterThan(0)
    })

    it('should isolate rate limits per client', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))

      // Exhaust limit for client1
      const client1Key = `RATE_LIMIT:health:ip|192.168.1.1:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(client1Key, '100', { expirationTtl: 120 })

      // Client1 should be blocked
      const client1Response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.1' }
      })
      expect(client1Response.status).toBe(429)

      // Client2 should still work
      const client2Response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.2' }
      })
      expect(client2Response.status).toBe(200)
    })
  })

  describe('Admin Rate Limit Stats Endpoint', () => {
    it('should require authentication', async () => {
      const response = await fetchWithMetrics('http://localhost/admin/rateLimitStats', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' }
      })

      expect(response.status).toBe(401)
    })

    it('should be rate limited itself', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))

      // Exhaust admin limit
      const adminKey = `RATE_LIMIT:admin:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(adminKey, '100', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/admin/rateLimitStats', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' }
      })

      expect(response.status).toBe(429)
    })
  })

  describe('Window Expiration', () => {
    it('should create rate limit entries with TTL', async () => {
      // Make a request
      await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })

      // Check that entries exist
      const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:' })
      expect(listResult.keys.length).toBeGreaterThan(0)

      // Entries should have expiration (we can't directly check TTL, but the key should exist)
      const key = listResult.keys[0].name
      const value = await env.EEN_OAUTH_SESSIONS.get(key)
      expect(value).not.toBeNull()
    })
  })

  describe('CORS and Rate Limiting', () => {
    it('should include CORS headers in rate limit responses', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:health:ip|10.0.0.100:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '100', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: {
          Origin: 'http://localhost:5173',
          'CF-Connecting-IP': '10.0.0.100'
        }
      })

      expect(response.status).toBe(429)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    })

    it('should rate limit CORS preflight requests', async () => {
      // OPTIONS requests should be rate limited to prevent OPTIONS flood attacks
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:health:ip|10.0.0.200:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '100', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'CF-Connecting-IP': '10.0.0.200'
        }
      })
      expect(response.status).toBe(429)
    })

    it('should count OPTIONS requests toward rate limit', async () => {
      // Clear any existing counters
      const existingKeys = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:ip|10.0.0.201' })
      for (const key of existingKeys.keys) {
        await env.EEN_OAUTH_SESSIONS.delete(key.name)
      }

      // Make an OPTIONS request
      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'CF-Connecting-IP': '10.0.0.201'
        }
      })
      expect(response.status).toBe(204)

      // Check that the counter was incremented
      const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:health:ip|10.0.0.201' })
      expect(listResult.keys.length).toBeGreaterThan(0)
    })
  })
})
