import { describe, it, expect } from 'vitest'
import { SELF } from 'cloudflare:test'

describe('CORS validation', () => {
  it('should reject requests from disallowed origins', async () => {
    const response = await SELF.fetch('http://localhost/health', {
      headers: {
        Origin: 'https://malicious-site.com'
      }
    })

    expect(response.status).toBe(403)
    const text = await response.text()
    expect(text).toContain('Forbidden')
  })

  it('should allow requests from allowed origins', async () => {
    const response = await SELF.fetch('http://localhost/health', {
      headers: {
        Origin: 'http://localhost:5173'
      }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('should handle CORS preflight requests', async () => {
    const response = await SELF.fetch('http://localhost/proxy/getAccessToken', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('should allow requests without origin header', async () => {
    const response = await SELF.fetch('http://localhost/health')

    expect(response.status).toBe(200)
  })
})

describe('Health endpoint', () => {
  it('should return ok status', async () => {
    const response = await SELF.fetch('http://localhost/health', {
      headers: {
        Origin: 'http://localhost:5173'
      }
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('ok')
  })
})

describe('404 handling', () => {
  it('should return 404 for unknown routes', async () => {
    const response = await SELF.fetch('http://localhost/unknown-route', {
      headers: {
        Origin: 'http://localhost:5173'
      }
    })

    expect(response.status).toBe(404)
  })
})
