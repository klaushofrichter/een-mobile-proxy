/**
 * Vitest Setup File
 *
 * Runs before tests and handles cleanup/reporting after tests.
 */

import { afterAll, beforeAll } from 'vitest'
import { resetMetrics, printReport, getMetrics } from './perf.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

beforeAll(() => {
  // Reset metrics at the start of test run
  resetMetrics()
  console.log('\n🔬 Starting API tests with performance measurement...\n')
})

afterAll(() => {
  // Print the performance report
  printReport()

  // Also save metrics to a JSON file for further analysis
  const metrics = getMetrics()

  if (metrics.calls.length > 0) {
    const reportDir = path.join(process.cwd(), 'test-reports')

    try {
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const jsonPath = path.join(reportDir, `perf-${timestamp}.json`)

      // Prepare summary data
      const summary = {
        timestamp: new Date().toISOString(),
        totalCalls: metrics.calls.length,
        endpoints: Object.entries(metrics.byEndpoint).map(([endpoint, data]) => ({
          endpoint,
          calls: data.count,
          minMs: data.min,
          maxMs: data.max,
          avgMs: data.total / data.count,
          totalMs: data.total,
          successCount: data.successCount,
          failCount: data.failCount
        }))
      }

      fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2))
      console.log(`\n📁 Performance data saved to: ${jsonPath}\n`)
    } catch (err) {
      // Ignore file write errors in worker context
      console.log('\n📊 Performance report generated (file save skipped in worker context)\n')
    }
  }
})
