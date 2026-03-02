import { describe, it, expect } from 'vitest'
import { fetchWithMetrics } from './test-utils.js'

describe('Mobile proxy - no CORS', () => {
  it('should not return CORS headers', async () => {
    const response = await fetchWithMetrics('http://localhost/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('should return 404 for OPTIONS preflight requests (not supported)', async () => {
    const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    })

    expect(response.status).toBe(404)
  })

  it('should allow requests without Origin header', async () => {
    const response = await fetchWithMetrics('http://localhost/health')

    expect(response.status).toBe(200)
  })

  it('should allow requests with any Origin header (no CORS enforcement)', async () => {
    const response = await fetchWithMetrics('http://localhost/health', {
      headers: {
        Origin: 'https://any-origin.com'
      }
    })

    expect(response.status).toBe(200)
  })
})

describe('Health endpoint', () => {
  it('should return ok status', async () => {
    const response = await fetchWithMetrics('http://localhost/health')

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('ok')
  })
})

describe('SPA fallback for unknown routes', () => {
  it('should serve admin SPA (200) for unknown routes via static assets', async () => {
    const response = await fetchWithMetrics('http://localhost/unknown-route')

    // Unknown routes serve the admin SPA index.html (via Workers Static Assets)
    expect(response.status).toBe(200)
  })
})
