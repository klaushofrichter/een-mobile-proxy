/**
 * Helper functions for Admin Playwright tests
 */

import { expect } from '@playwright/test'
import dotenv from 'dotenv'

export const MAX_TEST_TIMEOUT = 60000

// Load environment variables
dotenv.config()

/**
 * Get the configured proxy URL from environment
 */
export function getProxyUrl() {
  return process.env.VITE_PROXY_URL || 'http://localhost:8787'
}

/**
 * Check if the proxy URL is local (for destructive tests)
 */
export function isLocalProxy() {
  const proxyUrl = getProxyUrl()
  return proxyUrl.includes('localhost') || proxyUrl.includes('127.0.0.1')
}

/**
 * Get admin test credentials from environment
 * @returns {{ username: string, password: string }}
 */
export function getAdminCredentials() {
  const username = process.env.ADMIN_TEST_USER
  const password = process.env.ADMIN_TEST_PASSWORD
  if (!username || !password) {
    throw new Error('ADMIN_TEST_USER and ADMIN_TEST_PASSWORD must be set in .env')
  }
  return { username, password }
}

/**
 * Get test credentials from environment (for backwards compatibility, returns admin credentials)
 * @returns {{ username: string, password: string }}
 */
export function getTestCredentials() {
  return getAdminCredentials()
}

/**
 * Get non-admin test credentials from environment
 * @returns {{ username: string, password: string } | null} Returns null if not configured
 */
export function getNonAdminCredentials() {
  const username = process.env.TEST_USER
  const password = process.env.TEST_PASSWORD
  if (!username || !password) {
    return null
  }
  return { username, password }
}

/**
 * Check if non-admin test credentials are configured
 * @returns {boolean}
 */
export function hasNonAdminCredentials() {
  return getNonAdminCredentials() !== null
}

/**
 * Navigates to the app's login page
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function navigateToLogin(page) {
  console.log('📝 Navigating to Login page')
  await page.goto('/')
}

/**
 * Handles the EEN OAuth login flow
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} [customPassword] - Optional custom password (for wrong password tests)
 * @param {{ username: string, password: string }} [credentials] - Optional custom credentials
 */
export async function loginWithEEN(page, customPassword = null, credentials = null) {
  console.log('🔑 Starting EEN OAuth login')

  const creds = credentials || getTestCredentials()
  const username = creds.username
  const passwordToUse = customPassword !== null ? customPassword : creds.password

  // Wait for redirect to EEN
  await page.waitForURL(/.*eagleeyenetworks.com.*/, { timeout: 15000 })
  console.log('✅ Reached EEN signin page')

  // Fill email
  const emailInput = page.locator('#authentication--input__email')
  await emailInput.waitFor({ state: 'visible', timeout: 15000 })
  await emailInput.fill(username)
  console.log('📧 Entered email')

  // Click next
  await page.getByRole('button', { name: 'Next' }).click()

  // Fill password
  const passwordInput = page.locator('#authentication--input__password')
  await passwordInput.waitFor({ state: 'visible', timeout: 10000 })
  await passwordInput.fill(passwordToUse)
  console.log('🔒 Entered password')

  // Click sign in
  const signInButton = page.locator('#next')
  const signInButtonByText = page.getByRole('button', { name: 'Sign in' })
  try {
    await signInButton.click()
  } catch {
    await signInButtonByText.click()
  }
  console.log('✅ Submitted EEN login')
}

/**
 * Full login flow: navigate to login, click sign in, complete EEN OAuth
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function loginToAdmin(page) {
  console.log('🔑 Starting admin login flow')

  // Navigate to login page
  await navigateToLogin(page)

  // Click sign in button
  const loginButton = page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })
  await loginButton.click()
  console.log('👆 Clicked Sign in button')

  // Complete EEN OAuth flow
  await loginWithEEN(page)

  // Wait for redirect to dashboard
  await page.waitForURL('/dashboard', { timeout: 25000 })
  console.log('✅ Successfully logged in and redirected to dashboard')
}

/**
 * Logout from the admin app
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function logoutFromAdmin(page) {
  console.log('🚪 Starting logout')

  // Click logout button
  const logoutButton = page.getByRole('button', { name: /Logout/i })
  await logoutButton.click()

  // Wait for redirect to login page
  await page.waitForURL('/', { timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })).toBeVisible()
  console.log('✅ Successfully logged out')
}

/**
 * Check proxy health via the UI
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<{ status: string, version: string }>}
 */
export async function checkHealthFromDashboard(page) {
  console.log('🏥 Checking proxy health from dashboard')

  // Wait for health card to be visible
  await expect(page.locator('text=Proxy Health')).toBeVisible({ timeout: 10000 })

  // Click check health button
  await page.getByRole('button', { name: 'Check Health' }).click()
  console.log('👆 Clicked Check Health')

  // Wait for loading to complete
  await page.waitForTimeout(2000)

  // Get status
  const statusElement = page.locator('.bg-green-500, .bg-red-500').first()
  const isHealthy = await statusElement.evaluate(el => el.classList.contains('bg-green-500'))
  const status = isHealthy ? 'ok' : 'error'

  // Get version
  const versionCard = page.locator('text=Proxy Version').locator('..').locator('..')
  const version = await versionCard.locator('.font-mono').first().textContent()

  console.log(`✅ Health status: ${status}, version: ${version}`)
  return { status, version: version?.trim() || 'unknown' }
}

/**
 * Get session count from dashboard
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<number|null>} Returns null if admin access is denied
 */
export async function getSessionCountFromDashboard(page) {
  console.log('📊 Getting session count from dashboard')

  // Wait for sessions card
  await expect(page.locator('text=Active Sessions')).toBeVisible({ timeout: 10000 })

  // Click refresh to ensure fresh data
  const sessionsCard = page.locator('text=Active Sessions').locator('..')
  await sessionsCard.getByRole('button', { name: 'Refresh' }).click()

  // Wait for loading
  await page.waitForTimeout(2000)

  // Check for error (admin access required)
  const errorBanner = page.locator('text=/Admin access required|Authentication required/i')
  if (await errorBanner.isVisible().catch(() => false)) {
    console.log('⚠️ Admin access denied')
    return null
  }

  // Get count - look for the large number
  const countText = await sessionsCard.locator('.text-3xl').textContent()
  const count = parseInt(countText?.trim() || '0', 10)

  if (isNaN(count)) {
    console.log('⚠️ Could not parse session count')
    return null
  }

  console.log(`✅ Session count: ${count}`)
  return count
}

/**
 * Clear localStorage to reset app state
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function clearAppState(page) {
  console.log('🧹 Clearing app state')
  await page.evaluate(() => localStorage.clear())
  console.log('✅ localStorage cleared')
}

/**
 * Check if on dashboard page
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function verifyOnDashboard(page) {
  await expect(page).toHaveURL('/dashboard')
  await expect(page.locator('text=Proxy Health')).toBeVisible()
  await expect(page.locator('text=Active Sessions')).toBeVisible()
  await expect(page.locator('text=Admin Actions')).toBeVisible()
  console.log('✅ Verified on dashboard page')
}

/**
 * Check if admin access is working (no auth errors)
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<boolean>}
 */
export async function hasAdminAccess(page) {
  // Wait a moment for any errors to appear
  await page.waitForTimeout(2000)

  // Check for error banners
  const errorBanner = page.locator('.bg-red-50').filter({ hasText: /Admin access required|Authentication required/i })
  const hasError = await errorBanner.isVisible().catch(() => false)

  if (hasError) {
    console.log('⚠️ Admin access NOT available')
    return false
  }

  // Check if session count shows a number (not dash)
  const sessionCount = page.locator('text=Active Sessions').locator('..').locator('.text-3xl')
  const countText = await sessionCount.textContent().catch(() => '—')

  if (countText === '—' || countText === null) {
    console.log('⚠️ Admin access appears limited')
    return false
  }

  console.log('✅ Admin access confirmed')
  return true
}

/**
 * Dismiss any error banners
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function dismissErrors(page) {
  const dismissButton = page.locator('.bg-red-50 button:has-text("Dismiss")')
  while (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click()
    await page.waitForTimeout(500)
  }
}

/**
 * Attempt to login as a non-admin user and verify rejection
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<boolean>} true if user was properly rejected
 */
export async function attemptNonAdminLogin(page) {
  const nonAdminCreds = getNonAdminCredentials()
  if (!nonAdminCreds) {
    throw new Error('TEST_NON_ADMIN_USER and TEST_NON_ADMIN_PASSWORD must be set in .env')
  }

  console.log('🔑 Attempting login as non-admin user')

  // Navigate to login page
  await navigateToLogin(page)

  // Click sign in button
  const loginButton = page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })
  await loginButton.click()
  console.log('👆 Clicked Sign in button')

  // Complete EEN OAuth flow with non-admin credentials
  await loginWithEEN(page, null, nonAdminCreds)

  // Wait for the app to process the callback
  // Should NOT redirect to dashboard, should stay on login with error
  await page.waitForTimeout(5000)

  // Check if we're on login page with an error
  const currentUrl = page.url()
  const onLoginPage = currentUrl === 'http://127.0.0.1:3333/' || currentUrl.endsWith('/')
  const errorMessage = page.locator('.bg-red-50')
  const hasError = await errorMessage.isVisible().catch(() => false)
  const errorText = hasError ? await errorMessage.textContent() : ''

  console.log(`📋 Current URL: ${currentUrl}`)
  console.log(`📋 On login page: ${onLoginPage}`)
  console.log(`📋 Has error: ${hasError}`)
  console.log(`📋 Error text: ${errorText}`)

  // User should be rejected - on login page with admin access error
  const properlyRejected = onLoginPage && hasError && errorText.toLowerCase().includes('admin')

  if (properlyRejected) {
    console.log('✅ Non-admin user properly rejected')
  } else if (currentUrl.includes('/dashboard')) {
    console.log('❌ Non-admin user was able to access dashboard!')
  }

  return properlyRejected
}
