/**
 * Test Utilities with Performance Measurement
 *
 * Provides a wrapper around SELF.fetch that automatically measures performance.
 */

import { SELF } from 'cloudflare:test'
import { measureFetch } from './perf.js'

/**
 * Extract endpoint from URL
 */
function extractEndpoint(url) {
  try {
    const urlObj = new URL(url)
    return urlObj.pathname
  } catch {
    // If it's not a valid URL, just return as-is
    return url
  }
}

/**
 * Fetch with automatic performance measurement
 *
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function fetchWithMetrics(url, options = {}) {
  const endpoint = extractEndpoint(url)
  const method = options.method || 'GET'
  const fullEndpoint = `${method} ${endpoint}`

  return measureFetch(fullEndpoint, () => SELF.fetch(url, options))
}

/**
 * Create a bound fetcher for a specific test context
 * This is useful for cleaner test syntax
 */
export function createFetcher() {
  return {
    get: (url, options = {}) => fetchWithMetrics(url, { ...options, method: 'GET' }),
    post: (url, options = {}) => fetchWithMetrics(url, { ...options, method: 'POST' }),
    delete: (url, options = {}) => fetchWithMetrics(url, { ...options, method: 'DELETE' }),
    put: (url, options = {}) => fetchWithMetrics(url, { ...options, method: 'PUT' }),
    options: (url, options = {}) => fetchWithMetrics(url, { ...options, method: 'OPTIONS' })
  }
}

// Export a default fetcher instance
export const api = createFetcher()
