/**
 * Performance Benchmark Tests
 *
 * Systematically tests all API endpoints and generates a comprehensive
 * performance report at the end.
 *
 * Run with: npm run test:perf
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'

// Performance metrics storage
const perfMetrics = {
  calls: [],
  byEndpoint: {}
}

/**
 * Measure a single API call
 */
async function measure(name, url, options = {}) {
  const start = performance.now()
  const response = await SELF.fetch(url, options)
  const duration = performance.now() - start

  // Record metric
  perfMetrics.calls.push({ name, duration, status: response.status })

  if (!perfMetrics.byEndpoint[name]) {
    perfMetrics.byEndpoint[name] = { durations: [], statuses: [] }
  }
  perfMetrics.byEndpoint[name].durations.push(duration)
  perfMetrics.byEndpoint[name].statuses.push(response.status)

  return { response, duration }
}

/**
 * Calculate percentile
 */
function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

/**
 * Generate performance report
 */
function generateReport() {
  const endpoints = Object.keys(perfMetrics.byEndpoint).sort()

  let report = '\n'
  report += '═'.repeat(90) + '\n'
  report += '                        📊 API PERFORMANCE BENCHMARK REPORT\n'
  report += '═'.repeat(90) + '\n\n'

  // Header
  report += '┌─────────────────────────────────────────┬───────┬─────────┬─────────┬─────────┬─────────┬────────┐\n'
  report += '│ Endpoint                                │ Calls │ Min(ms) │ Avg(ms) │ Max(ms) │ P95(ms) │ Status │\n'
  report += '├─────────────────────────────────────────┼───────┼─────────┼─────────┼─────────┼─────────┼────────┤\n'

  let totalCalls = 0
  let totalDuration = 0
  const categoryStats = {
    'OAuth /proxy/*': { calls: 0, duration: 0 },
    'Admin /admin/*': { calls: 0, duration: 0 },
    'Health /health': { calls: 0, duration: 0 }
  }

  for (const endpoint of endpoints) {
    const data = perfMetrics.byEndpoint[endpoint]
    const durations = data.durations
    const statuses = data.statuses

    const min = Math.min(...durations)
    const max = Math.max(...durations)
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length
    const p95 = percentile(durations, 95)
    const statusCode = statuses[0]

    totalCalls += durations.length
    totalDuration += durations.reduce((a, b) => a + b, 0)

    // Categorize
    if (endpoint.includes('/proxy/')) {
      categoryStats['OAuth /proxy/*'].calls += durations.length
      categoryStats['OAuth /proxy/*'].duration += durations.reduce((a, b) => a + b, 0)
    } else if (endpoint.includes('/admin/')) {
      categoryStats['Admin /admin/*'].calls += durations.length
      categoryStats['Admin /admin/*'].duration += durations.reduce((a, b) => a + b, 0)
    } else if (endpoint.includes('/health')) {
      categoryStats['Health /health'].calls += durations.length
      categoryStats['Health /health'].duration += durations.reduce((a, b) => a + b, 0)
    }

    const endpointDisplay = endpoint.length > 39 ? endpoint.substring(0, 36) + '...' : endpoint.padEnd(39)
    const statusDisplay = statusCode.toString().padStart(6)

    report += `│ ${endpointDisplay} │ ${String(durations.length).padStart(5)} │ ${min.toFixed(1).padStart(7)} │ ${avg.toFixed(1).padStart(7)} │ ${max.toFixed(1).padStart(7)} │ ${p95.toFixed(1).padStart(7)} │${statusDisplay} │\n`
  }

  report += '└─────────────────────────────────────────┴───────┴─────────┴─────────┴─────────┴─────────┴────────┘\n\n'

  // Summary
  report += '📈 SUMMARY\n'
  report += '─'.repeat(50) + '\n'
  report += `Total API Calls:           ${totalCalls}\n`
  report += `Total Execution Time:      ${totalDuration.toFixed(2)} ms\n`
  report += `Average Response Time:     ${(totalDuration / totalCalls).toFixed(2)} ms\n`
  report += `Unique Endpoints Tested:   ${endpoints.length}\n`

  // Find slowest and fastest
  let slowest = { name: '', avg: 0 }
  let fastest = { name: '', avg: Infinity }

  for (const [name, data] of Object.entries(perfMetrics.byEndpoint)) {
    const avg = data.durations.reduce((a, b) => a + b, 0) / data.durations.length
    if (avg > slowest.avg) slowest = { name, avg }
    if (avg < fastest.avg) fastest = { name, avg }
  }

  report += `\n🐢 Slowest Endpoint:       ${slowest.name}\n`
  report += `                           ${slowest.avg.toFixed(2)} ms average\n`
  report += `🚀 Fastest Endpoint:       ${fastest.name}\n`
  report += `                           ${fastest.avg.toFixed(2)} ms average\n`

  // Category breakdown
  report += '\n📋 BREAKDOWN BY CATEGORY\n'
  report += '─'.repeat(50) + '\n'

  for (const [category, stats] of Object.entries(categoryStats)) {
    if (stats.calls === 0) continue
    const avg = stats.duration / stats.calls
    report += `${category.padEnd(20)} ${String(stats.calls).padStart(4)} calls   ${stats.duration.toFixed(1).padStart(8)} ms total   ${avg.toFixed(2).padStart(7)} ms avg\n`
  }

  // Performance assessment
  report += '\n⚡ PERFORMANCE ASSESSMENT\n'
  report += '─'.repeat(50) + '\n'

  const avgResponseTime = totalDuration / totalCalls
  if (avgResponseTime < 10) {
    report += '✅ Excellent: Average response time < 10ms\n'
  } else if (avgResponseTime < 50) {
    report += '✅ Good: Average response time < 50ms\n'
  } else if (avgResponseTime < 100) {
    report += '⚠️  Acceptable: Average response time < 100ms\n'
  } else {
    report += '❌ Needs improvement: Average response time > 100ms\n'
  }

  report += '\n' + '═'.repeat(90) + '\n'

  return report
}

describe('Performance Benchmarks', () => {
  const adminSessionId = 'perf-admin-session-test-id'
  const userSessionId = 'perf-user-session-test-id'

  beforeAll(async () => {
    // Clear any existing data
    const keys = await env.EEN_OAUTH_SESSIONS.list()
    for (const key of keys.keys) {
      await env.EEN_OAUTH_SESSIONS.delete(key.name)
    }

    // Set up test sessions
    await env.EEN_OAUTH_SESSIONS.put(
      adminSessionId,
      JSON.stringify({
        refreshToken: 'perf-admin-token',
        userEmail: 'admin@example.com',
        createdAt: Date.now()
      })
    )

    await env.EEN_OAUTH_SESSIONS.put(
      userSessionId,
      JSON.stringify({
        refreshToken: 'perf-user-token',
        userEmail: 'user@example.com',
        createdAt: Date.now()
      })
    )

    await env.EEN_OAUTH_SESSIONS.put('DEPLOY_VERSION', '1.0.0-perf')
  })

  afterAll(() => {
    console.log(generateReport())
  })

  describe('Health Endpoint', () => {
    it('should measure /health response time (10 iterations)', async () => {
      for (let i = 0; i < 10; i++) {
        const { response, duration } = await measure('GET /health', 'http://localhost/health', {
          headers: { Origin: 'http://localhost:5173', 'CF-Connecting-IP': '10.99.99.1' }
        })
        expect(response.status).toBe(200)
      }
    })
  })

  describe('OAuth Endpoints', () => {
    it('should measure POST /proxy/getAccessToken (validation error)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'POST /proxy/getAccessToken (400)',
          'http://localhost/proxy/getAccessToken',
          {
            method: 'POST',
            headers: { Origin: 'http://localhost:5173' }
          }
        )
        expect(response.status).toBe(400)
      }
    })

    it('should measure POST /proxy/refreshAccessToken (no session)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'POST /proxy/refreshAccessToken (401)',
          'http://localhost/proxy/refreshAccessToken',
          {
            method: 'POST',
            headers: { Origin: 'http://localhost:5173' }
          }
        )
        expect(response.status).toBe(401)
      }
    })

    it('should measure POST /proxy/refreshAccessToken (invalid session)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'POST /proxy/refreshAccessToken (invalid)',
          'http://localhost/proxy/refreshAccessToken',
          {
            method: 'POST',
            headers: {
              Origin: 'http://localhost:5173',
              Cookie: 'sessionId=invalid-session-test-id-12345'
            }
          }
        )
        expect(response.status).toBe(401)
      }
    })

    it('should measure POST /proxy/revoke (no session)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'POST /proxy/revoke (401)',
          'http://localhost/proxy/revoke',
          {
            method: 'POST',
            headers: { Origin: 'http://localhost:5173' }
          }
        )
        expect(response.status).toBe(401)
      }
    })

    it('should measure POST /proxy/revoke (valid session)', async () => {
      // Create a temporary session for this test
      const tempSessionId = `temp-session-${Date.now()}`
      await env.EEN_OAUTH_SESSIONS.put(
        tempSessionId,
        JSON.stringify({
          refreshToken: 'temp-token',
          userEmail: 'temp@example.com',
          createdAt: Date.now()
        })
      )

      const { response } = await measure(
        'POST /proxy/revoke (200)',
        'http://localhost/proxy/revoke',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            Cookie: `sessionId=${tempSessionId}`
          }
        }
      )
      expect(response.status).toBe(200)
    })
  })

  describe('Admin Endpoints', () => {
    it('should measure GET /admin/sessionsCount (admin)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'GET /admin/sessionsCount (200)',
          'http://localhost/admin/sessionsCount',
          {
            headers: {
              Origin: 'http://localhost:5173',
              Cookie: `sessionId=${adminSessionId}`
            }
          }
        )
        expect(response.status).toBe(200)
      }
    })

    it('should measure GET /admin/sessionsCount (unauthorized)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'GET /admin/sessionsCount (401)',
          'http://localhost/admin/sessionsCount',
          {
            headers: { Origin: 'http://localhost:5173' }
          }
        )
        expect(response.status).toBe(401)
      }
    })

    it('should measure GET /admin/sessionsCount (forbidden)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'GET /admin/sessionsCount (403)',
          'http://localhost/admin/sessionsCount',
          {
            headers: {
              Origin: 'http://localhost:5173',
              Cookie: `sessionId=${userSessionId}`
            }
          }
        )
        expect(response.status).toBe(403)
      }
    })

    it('should measure GET /admin/version (admin)', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'GET /admin/version (200)',
          'http://localhost/admin/version',
          {
            headers: {
              Origin: 'http://localhost:5173',
              Cookie: `sessionId=${adminSessionId}`
            }
          }
        )
        expect(response.status).toBe(200)
      }
    })

    it('should measure DELETE /admin/removeSessions (admin)', async () => {
      // Add extra sessions to remove
      for (let i = 0; i < 3; i++) {
        await env.EEN_OAUTH_SESSIONS.put(
          `extra-session-${i}`,
          JSON.stringify({
            refreshToken: `extra-token-${i}`,
            userEmail: `extra${i}@example.com`,
            createdAt: Date.now()
          })
        )
      }

      const { response } = await measure(
        'DELETE /admin/removeSessions (200)',
        'http://localhost/admin/removeSessions',
        {
          method: 'DELETE',
          headers: {
            Origin: 'http://localhost:5173',
            Cookie: `sessionId=${adminSessionId}`
          }
        }
      )
      expect(response.status).toBe(200)
    })
  })

  describe('CORS Handling', () => {
    it('should measure OPTIONS preflight request', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'OPTIONS /proxy/getAccessToken (204)',
          'http://localhost/proxy/getAccessToken',
          {
            method: 'OPTIONS',
            headers: {
              Origin: 'http://localhost:5173',
              'Access-Control-Request-Method': 'POST'
            }
          }
        )
        expect(response.status).toBe(204)
      }
    })

    it('should measure rejected CORS request', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'GET /health (CORS rejected)',
          'http://localhost/health',
          {
            headers: { Origin: 'https://malicious-site.com' }
          }
        )
        expect(response.status).toBe(403)
      }
    })
  })

  describe('Error Handling', () => {
    it('should measure 404 response', async () => {
      for (let i = 0; i < 5; i++) {
        const { response } = await measure(
          'GET /unknown-route (404)',
          'http://localhost/unknown-route',
          {
            headers: { Origin: 'http://localhost:5173' }
          }
        )
        expect(response.status).toBe(404)
      }
    })
  })
})
