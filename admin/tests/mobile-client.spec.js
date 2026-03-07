/**
 * Mobile Client Login Flow Tests
 *
 * Simulates a mobile app OAuth flow using Playwright:
 * 1. Navigate to EEN OAuth URL to get an authorization code
 * 2. Exchange code via POST /proxy/getAccessToken (like a mobile client)
 * 3. Use the returned sessionId as Bearer token for subsequent API calls
 * 4. Refresh token via POST /proxy/refreshAccessToken
 * 5. Revoke token via POST /proxy/revoke
 *
 * Unlike the admin browser tests, these tests interact with the proxy
 * purely via HTTP API calls (Bearer token auth), not browser sessions.
 */

import { test, expect } from '@playwright/test'
import {
  loginWithEEN,
  getAdminCredentials,
  clearAppState,
  getProxyUrl,
  MAX_TEST_TIMEOUT
} from './utils.js'
import dotenv from 'dotenv'

dotenv.config()

const CLIENT_ID = process.env.VITE_EEN_CLIENT_ID || 'PREVIEW-KLAUS-MOBILE'
const PROXY_URL = getProxyUrl()
const REDIRECT_URI = PROXY_URL // http://127.0.0.1:3333 — allowed in dev via http scheme

/**
 * Build the EEN OAuth authorization URL
 */
function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'vms.all',
    state
  })
  return `https://auth.eagleeyenetworks.com/oauth2/authorize?${params.toString()}`
}

/**
 * Navigate through EEN OAuth login and capture the authorization code from the redirect.
 * Returns the code extracted from the callback URL.
 */
async function getAuthorizationCode(page) {
  const state = 'test-state-' + Date.now()
  const authUrl = buildAuthUrl(state)

  // Intercept the redirect back to our proxy to capture the code
  // before the page actually loads (the proxy would serve the SPA)
  let capturedCode = null

  // Listen for the redirect to our proxy origin
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === PROXY_URL && url.searchParams.has('code')) {
      capturedCode = url.searchParams.get('code')
    }
  })

  // Navigate to EEN OAuth
  await page.goto(authUrl)

  // Complete the EEN login
  await loginWithEEN(page)

  // Wait for redirect back to proxy with the code
  await page.waitForURL(url => {
    try {
      const parsed = new URL(url)
      return parsed.origin === PROXY_URL && parsed.searchParams.has('code')
    } catch {
      return false
    }
  }, { timeout: 25000 })

  // Extract code from URL if not captured via request listener
  if (!capturedCode) {
    const currentUrl = new URL(page.url())
    capturedCode = currentUrl.searchParams.get('code')
  }

  if (!capturedCode) {
    throw new Error('Failed to capture authorization code from redirect')
  }

  console.log(`Got authorization code: ${capturedCode.substring(0, 8)}...`)
  return capturedCode
}

test.describe('Mobile Client OAuth Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearAppState(page)
  })

  test('should complete full mobile OAuth flow: login, refresh, revoke', async ({ page, request }) => {
    console.log('\n--- Running Test: Full mobile OAuth flow\n')
    test.setTimeout(MAX_TEST_TIMEOUT * 2)

    // Step 1: Get authorization code via browser login
    console.log('Step 1: Getting authorization code via EEN login...')
    const code = await getAuthorizationCode(page)
    expect(code).toBeTruthy()
    console.log('Got authorization code')

    // Step 2: Exchange code for tokens via proxy API (mobile-style POST)
    console.log('Step 2: Exchanging code for tokens via POST /proxy/getAccessToken...')
    const tokenResponse = await request.post(`${PROXY_URL}/proxy/getAccessToken`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    })

    expect(tokenResponse.status()).toBe(200)
    const tokenData = await tokenResponse.json()

    // Verify response has expected fields
    expect(tokenData.accessToken).toBeTruthy()
    expect(tokenData.sessionId).toBeTruthy()
    expect(tokenData.expiresIn).toBeGreaterThan(0)
    console.log(`Got sessionId: ${tokenData.sessionId.substring(0, 8)}...`)
    console.log(`Got accessToken (expires in ${tokenData.expiresIn}s)`)

    if (tokenData.httpsBaseUrl) {
      console.log(`Got httpsBaseUrl: ${tokenData.httpsBaseUrl}`)
    }

    const sessionId = tokenData.sessionId

    // Step 3: Refresh token via Bearer auth (mobile-style)
    console.log('Step 3: Refreshing token via POST /proxy/refreshAccessToken...')
    const refreshResponse = await request.post(`${PROXY_URL}/proxy/refreshAccessToken`, {
      headers: { Authorization: `Bearer ${sessionId}` }
    })

    expect(refreshResponse.status()).toBe(200)
    const refreshData = await refreshResponse.json()
    expect(refreshData.accessToken).toBeTruthy()
    expect(refreshData.expiresIn).toBeGreaterThan(0)
    console.log(`Refreshed token (new expiry: ${refreshData.expiresIn}s)`)

    // Step 4: Revoke token via Bearer auth (mobile-style)
    console.log('Step 4: Revoking token via POST /proxy/revoke...')
    const revokeResponse = await request.post(`${PROXY_URL}/proxy/revoke`, {
      headers: { Authorization: `Bearer ${sessionId}` }
    })

    expect(revokeResponse.status()).toBe(200)
    const revokeData = await revokeResponse.json()
    expect(revokeData.message).toContain('revoked')
    console.log('Token revoked successfully')

    // Step 5: Verify session is gone — refresh should fail
    console.log('Step 5: Verifying session is invalidated...')
    const postRevokeResponse = await request.post(`${PROXY_URL}/proxy/refreshAccessToken`, {
      headers: { Authorization: `Bearer ${sessionId}` }
    })

    expect(postRevokeResponse.status()).toBe(401)
    console.log('Session correctly invalidated after revoke')

    console.log('\n--- Full mobile OAuth flow test completed!\n')
  })

  test('should reject token exchange with invalid code', async ({ request }) => {
    console.log('\n--- Running Test: Invalid code rejection\n')

    const response = await request.post(`${PROXY_URL}/proxy/getAccessToken`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `code=invalid-code-12345&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    })

    // EEN should reject the invalid code
    expect(response.status()).toBeGreaterThanOrEqual(400)
    console.log(`Invalid code rejected with status ${response.status()}`)

    console.log('\n--- Invalid code rejection test completed!\n')
  })

  test('should reject refresh with invalid session', async ({ request }) => {
    console.log('\n--- Running Test: Invalid session rejection\n')

    const response = await request.post(`${PROXY_URL}/proxy/refreshAccessToken`, {
      headers: { Authorization: 'Bearer invalid-session-id-12345' }
    })

    expect(response.status()).toBe(401)
    const data = await response.json()
    expect(data.error).toBeTruthy()
    console.log(`Invalid session rejected: ${data.error}`)

    console.log('\n--- Invalid session rejection test completed!\n')
  })

  test('should reject requests without Bearer token', async ({ request }) => {
    console.log('\n--- Running Test: Missing Bearer token rejection\n')

    const response = await request.post(`${PROXY_URL}/proxy/refreshAccessToken`)

    expect(response.status()).toBe(401)
    const data = await response.json()
    expect(data.error).toContain('No session')
    console.log(`Missing token rejected: ${data.error}`)

    console.log('\n--- Missing Bearer token rejection test completed!\n')
  })

  test('should reject token exchange without redirect_uri', async ({ request }) => {
    console.log('\n--- Running Test: Missing redirect_uri rejection\n')

    const response = await request.post(`${PROXY_URL}/proxy/getAccessToken`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'code=some-code'
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Missing')
    console.log(`Missing redirect_uri rejected: ${data.error}`)

    console.log('\n--- Missing redirect_uri rejection test completed!\n')
  })
})
