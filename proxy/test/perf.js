/**
 * Performance Measurement Utility for API Tests
 *
 * Wraps fetch calls to measure response times and generates a report.
 */

// Global metrics storage
const metrics = {
  calls: [],
  byEndpoint: {}
}

/**
 * Measure the performance of a fetch call
 * @param {string} endpoint - The API endpoint being called
 * @param {Function} fetchFn - Async function that performs the fetch
 * @returns {Promise<Response>} - The fetch response
 */
export async function measureFetch(endpoint, fetchFn) {
  const startTime = performance.now()

  try {
    const response = await fetchFn()
    const endTime = performance.now()
    const duration = endTime - startTime

    recordMetric(endpoint, duration, response.status, true)

    return response
  } catch (error) {
    const endTime = performance.now()
    const duration = endTime - startTime

    recordMetric(endpoint, duration, 0, false, error.message)

    throw error
  }
}

/**
 * Record a metric
 */
function recordMetric(endpoint, duration, status, success, error = null) {
  const metric = {
    endpoint,
    duration,
    status,
    success,
    error,
    timestamp: new Date().toISOString()
  }

  metrics.calls.push(metric)

  // Group by endpoint
  if (!metrics.byEndpoint[endpoint]) {
    metrics.byEndpoint[endpoint] = {
      calls: [],
      min: Infinity,
      max: -Infinity,
      total: 0,
      count: 0,
      successCount: 0,
      failCount: 0
    }
  }

  const endpointMetrics = metrics.byEndpoint[endpoint]
  endpointMetrics.calls.push(metric)
  endpointMetrics.min = Math.min(endpointMetrics.min, duration)
  endpointMetrics.max = Math.max(endpointMetrics.max, duration)
  endpointMetrics.total += duration
  endpointMetrics.count++

  if (success) {
    endpointMetrics.successCount++
  } else {
    endpointMetrics.failCount++
  }
}

/**
 * Get all collected metrics
 */
export function getMetrics() {
  return metrics
}

/**
 * Reset all metrics
 */
export function resetMetrics() {
  metrics.calls = []
  metrics.byEndpoint = {}
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
 * Generate a performance report
 */
export function generateReport() {
  const endpoints = Object.keys(metrics.byEndpoint).sort()

  if (endpoints.length === 0) {
    return '\n📊 No API calls were measured.\n'
  }

  let report = '\n'
  report += '═'.repeat(80) + '\n'
  report += '📊 API PERFORMANCE REPORT\n'
  report += '═'.repeat(80) + '\n\n'

  // Summary table
  report += '┌─────────────────────────────────────┬───────┬─────────┬─────────┬─────────┬─────────┐\n'
  report += '│ Endpoint                            │ Calls │ Min(ms) │ Avg(ms) │ Max(ms) │ P95(ms) │\n'
  report += '├─────────────────────────────────────┼───────┼─────────┼─────────┼─────────┼─────────┤\n'

  let totalCalls = 0
  let totalDuration = 0

  for (const endpoint of endpoints) {
    const data = metrics.byEndpoint[endpoint]
    const avg = data.total / data.count
    const durations = data.calls.map(c => c.duration)
    const p95 = percentile(durations, 95)

    totalCalls += data.count
    totalDuration += data.total

    const endpointDisplay = endpoint.length > 35 ? endpoint.substring(0, 32) + '...' : endpoint.padEnd(35)

    report += `│ ${endpointDisplay} │ ${String(data.count).padStart(5)} │ ${data.min.toFixed(1).padStart(7)} │ ${avg.toFixed(1).padStart(7)} │ ${data.max.toFixed(1).padStart(7)} │ ${p95.toFixed(1).padStart(7)} │\n`
  }

  report += '└─────────────────────────────────────┴───────┴─────────┴─────────┴─────────┴─────────┘\n\n'

  // Overall statistics
  report += '📈 SUMMARY\n'
  report += '─'.repeat(40) + '\n'
  report += `Total API Calls:      ${totalCalls}\n`
  report += `Total Time:           ${totalDuration.toFixed(1)} ms\n`
  report += `Average per Call:     ${(totalDuration / totalCalls).toFixed(2)} ms\n`
  report += `Unique Endpoints:     ${endpoints.length}\n`

  // Find slowest and fastest
  let slowest = { endpoint: '', duration: -Infinity }
  let fastest = { endpoint: '', duration: Infinity }

  for (const endpoint of endpoints) {
    const data = metrics.byEndpoint[endpoint]
    const avg = data.total / data.count

    if (avg > slowest.duration) {
      slowest = { endpoint, duration: avg }
    }
    if (avg < fastest.duration) {
      fastest = { endpoint, duration: avg }
    }
  }

  report += `\n🐢 Slowest (avg):      ${slowest.endpoint} (${slowest.duration.toFixed(2)} ms)\n`
  report += `🚀 Fastest (avg):      ${fastest.endpoint} (${fastest.duration.toFixed(2)} ms)\n`

  // Detailed breakdown by endpoint category
  report += '\n📋 BREAKDOWN BY CATEGORY\n'
  report += '─'.repeat(40) + '\n'

  const categories = {
    'OAuth': endpoints.filter(e => e.includes('/proxy/')),
    'Admin': endpoints.filter(e => e.includes('/admin/')),
    'Health': endpoints.filter(e => e.includes('/health')),
    'Other': endpoints.filter(e => !e.includes('/proxy/') && !e.includes('/admin/') && !e.includes('/health'))
  }

  for (const [category, categoryEndpoints] of Object.entries(categories)) {
    if (categoryEndpoints.length === 0) continue

    let catCalls = 0
    let catDuration = 0

    for (const endpoint of categoryEndpoints) {
      const data = metrics.byEndpoint[endpoint]
      catCalls += data.count
      catDuration += data.total
    }

    report += `${category.padEnd(15)} ${String(catCalls).padStart(5)} calls, ${catDuration.toFixed(1).padStart(10)} ms total, ${(catDuration / catCalls).toFixed(2).padStart(8)} ms avg\n`
  }

  // Breakdown by HTTP method
  report += '\n📊 BREAKDOWN BY HTTP METHOD\n'
  report += '─'.repeat(40) + '\n'

  const methods = {}
  for (const endpoint of endpoints) {
    const method = endpoint.split(' ')[0]
    if (!methods[method]) {
      methods[method] = { calls: 0, total: 0 }
    }
    const data = metrics.byEndpoint[endpoint]
    methods[method].calls += data.count
    methods[method].total += data.total
  }

  for (const [method, data] of Object.entries(methods).sort((a, b) => b[1].calls - a[1].calls)) {
    report += `${method.padEnd(8)} ${String(data.calls).padStart(5)} calls, ${data.total.toFixed(1).padStart(10)} ms total, ${(data.total / data.calls).toFixed(2).padStart(8)} ms avg\n`
  }

  // Top 10 slowest individual calls
  report += '\n🐌 TOP 10 SLOWEST ENDPOINTS (by average)\n'
  report += '─'.repeat(40) + '\n'

  const sortedByAvg = endpoints
    .map(e => ({ endpoint: e, avg: metrics.byEndpoint[e].total / metrics.byEndpoint[e].count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10)

  for (let i = 0; i < sortedByAvg.length; i++) {
    const { endpoint, avg } = sortedByAvg[i]
    report += `${String(i + 1).padStart(2)}. ${endpoint.substring(0, 40).padEnd(40)} ${avg.toFixed(2).padStart(8)} ms\n`
  }

  report += '\n' + '═'.repeat(80) + '\n'

  return report
}

/**
 * Print the performance report to console
 */
export function printReport() {
  console.log(generateReport())
}
