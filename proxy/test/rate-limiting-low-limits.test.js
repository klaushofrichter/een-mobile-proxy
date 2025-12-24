/**
 * Rate Limiting Tests with Low Limits
 *
 * These tests verify that rate limiting triggers correctly with very low limits.
 * The limits are set via the test environment to make it easy to trigger 429 responses.
 *
 * To run these tests with low limits locally, use:
 *   RATE_LIMIT_HEALTH=3 RATE_LIMIT_OAUTH=2 RATE_LIMIT_ADMIN=2 npm test -- rate-limiting-low-limits
 *
 * Note: These tests directly manipulate KV to simulate low limits since we can't
 * easily change environment bindings per-test in vitest.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Rate Limiting - Low Limit Scenarios', () => {
  // Simulate a very low limit by pre-populating the counter
  const simulateLowLimit = async (category, limit) => {
    const bucket = Math.floor(Date.now() / (60 * 1000))
    const key = `RATE_LIMIT:${category}:unknown:${bucket}`
    // Set counter to limit - 1 so next request will be allowed, but the one after blocked
    await env.EEN_OAUTH_SESSIONS.put(key, String(limit - 1), { expirationTtl: 120 })
    return key
  }

  beforeEach(async () => {
    // Clear all rate limit keys
    const listResult = await env.EEN_OAUTH_SESSIONS.list({ prefix: 'RATE_LIMIT:' })
    for (const key of listResult.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }
  })

  describe('Health Endpoint with Low Limit', () => {
    it('should return 429 after exceeding default limit of 60', async () => {
      // Default health limit is 60, set counter to 60 to trigger rate limit
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:health:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '60', { expirationTtl: 120 })

      // Request should be blocked (counter is at limit)
      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })
      expect(response.status).toBe(429)

      const data = await response.json()
      expect(data.error).toBe('rate_limit_exceeded')
      expect(data.retryAfter).toBeGreaterThan(0)
    })

    it('should include Retry-After header when blocked', async () => {
      // Set counter above limit
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:health:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '100', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBeDefined()

      const retryAfter = parseInt(response.headers.get('Retry-After'), 10)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(60) // Should be within window
    })
  })

  describe('OAuth Endpoint with Low Limit', () => {
    it('should return 429 after exceeding default limit of 30', async () => {
      // Default OAuth limit is 30, set counter to 30 to trigger rate limit
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:oauth:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '30', { expirationTtl: 120 })

      // Request should be blocked before hitting the auth layer
      const response = await fetchWithMetrics(
        'http://localhost/proxy/getAccessToken?code=test&redirect_uri=http://localhost:5173',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )

      expect(response.status).toBe(429)
      const data = await response.json()
      expect(data.error).toBe('rate_limit_exceeded')
    })

    it('should block refresh token requests when rate limited', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:oauth:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '50', { expirationTtl: 120 })

      const response = await fetchWithMetrics(
        'http://localhost/proxy/refreshAccessToken',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' }
        }
      )

      expect(response.status).toBe(429)
    })

    it('should block revoke requests when rate limited', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:oauth:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '50', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/proxy/revoke', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' }
      })

      expect(response.status).toBe(429)
    })
  })

  describe('Admin Endpoint with Low Limit', () => {
    it('should return 429 after exceeding default limit of 60', async () => {
      // Default admin limit is 60, set counter to 60 to trigger rate limit
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:admin:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '60', { expirationTtl: 120 })

      // Request should be blocked before hitting the auth layer
      const response = await fetchWithMetrics('http://localhost/admin/version', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' }
      })

      expect(response.status).toBe(429)
      const data = await response.json()
      expect(data.error).toBe('rate_limit_exceeded')
    })

    it('should block session count requests when rate limited', async () => {
      // Default admin limit is 60, set counter to 60 to trigger rate limit
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:admin:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '60', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/admin/sessionsCount', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' }
      })

      expect(response.status).toBe(429)
    })
  })

  describe('Sequential Requests to Trigger Rate Limit', () => {
    it('should progressively count requests and eventually block', async () => {
      // Clear the counter
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:health:ip|10.1.1.1:${bucket}`
      await env.EEN_OAUTH_SESSIONS.delete(key)

      // Start by setting counter to just below limit
      await env.EEN_OAUTH_SESSIONS.put(key, '58', { expirationTtl: 120 })

      // Make requests from same "IP"
      const headers = {
        'CF-Connecting-IP': '10.1.1.1'
      }

      // First request should succeed
      const r1 = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers
      })
      expect(r1.status).toBe(200)

      // Wait for counter increment
      await new Promise(resolve => setTimeout(resolve, 100))

      // Second request should succeed
      const r2 = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers
      })
      expect(r2.status).toBe(200)

      // Wait for counter increment
      await new Promise(resolve => setTimeout(resolve, 100))

      // Now manually set to limit
      await env.EEN_OAUTH_SESSIONS.put(key, '60', { expirationTtl: 120 })

      // Third request should be blocked
      const r3 = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers
      })
      expect(r3.status).toBe(429)
    })
  })

  describe('Different Clients Under Same Rate Limit', () => {
    it('should not affect other clients when one is rate limited', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))

      // Rate limit client A
      const keyA = `RATE_LIMIT:health:ip|192.168.1.100:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(keyA, '100', { expirationTtl: 120 })

      // Client A is blocked
      const responseA = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.100' }
      })
      expect(responseA.status).toBe(429)

      // Client B is not blocked
      const responseB = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.200' }
      })
      expect(responseB.status).toBe(200)

      // Client C is not blocked
      const responseC = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.201' }
      })
      expect(responseC.status).toBe(200)
    })
  })

  describe('Rate Limit Recovery', () => {
    it('should allow requests after window expires (simulated)', async () => {
      // Use a bucket from the past to simulate expired window
      const currentBucket = Math.floor(Date.now() / (60 * 1000))
      const oldBucket = currentBucket - 1
      const clientIp = '10.2.2.2'

      // Set high counter for OLD bucket (should be ignored)
      const oldKey = `RATE_LIMIT:health:ip|${clientIp}:${oldBucket}`
      await env.EEN_OAUTH_SESSIONS.put(oldKey, '1000', { expirationTtl: 120 })

      // Current bucket should have no counter, so request succeeds
      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': clientIp }
      })

      expect(response.status).toBe(200)
    })
  })

  describe('Error Response Format Validation', () => {
    it('should return properly formatted JSON error', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:health:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '999', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET'
      })

      expect(response.status).toBe(429)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const data = await response.json()

      // Verify all required fields
      expect(data).toHaveProperty('error', 'rate_limit_exceeded')
      expect(data).toHaveProperty('message')
      expect(data).toHaveProperty('retryAfter')
      expect(typeof data.message).toBe('string')
      expect(typeof data.retryAfter).toBe('number')
      expect(data.retryAfter).toBeGreaterThan(0)
    })

    it('should include security headers even on 429 response', async () => {
      const bucket = Math.floor(Date.now() / (60 * 1000))
      const key = `RATE_LIMIT:health:unknown:${bucket}`
      await env.EEN_OAUTH_SESSIONS.put(key, '999', { expirationTtl: 120 })

      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' }
      })

      expect(response.status).toBe(429)
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    })
  })
})
