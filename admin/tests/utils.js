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
  console.log(`📍 Current URL: ${page.url()}`)

  // Wait a moment for page to fully load
  await page.waitForTimeout(2000)

  // Debug: log page title and check for common elements
  const pageTitle = await page.title()
  console.log(`📄 Page title: ${pageTitle}`)

  // Fill email - try multiple selectors
  const emailInput = page.locator('#authentication--input__email')
  const emailInputAlt = page.locator('input[type="email"]')
  const emailInputByPlaceholder = page.locator('input[placeholder*="email" i]')

  let foundInput = null
  for (const input of [emailInput, emailInputAlt, emailInputByPlaceholder]) {
    if (await input.isVisible().catch(() => false)) {
      foundInput = input
      break
    }
  }

  if (!foundInput) {
    // Log page content for debugging
    const bodyText = await page.locator('body').textContent().catch(() => 'Could not get body text')
    console.log(`⚠️ Email input not found. Page content preview: ${bodyText.substring(0, 500)}`)
    // Fall back to original selector with longer timeout
    await emailInput.waitFor({ state: 'visible', timeout: 30000 })
    foundInput = emailInput
  }

  await foundInput.fill(username)
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

  // Click logout button (exact match to avoid matching "Logout & Revoke")
  const logoutButton = page.getByRole('button', { name: 'Logout', exact: true })
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

  // Click check button
  await page.getByRole('button', { name: 'Update now' }).click()
  console.log('👆 Clicked Update now')

  // Wait for loading to complete
  await page.waitForTimeout(2000)

  // Get status from the indicator dot
  const statusElement = page.locator('.bg-green-500, .bg-red-500').first()
  const isHealthy = await statusElement.evaluate(el => el.classList.contains('bg-green-500'))
  const status = isHealthy ? 'ok' : 'error'

  // Get version from the Versions card
  const proxyVersionRow = page.locator('text=Proxy:').locator('..')
  const proxyVersionText = await proxyVersionRow.locator('.font-mono').textContent()

  console.log(`✅ Health status: ${status}, version: ${proxyVersionText}`)
  return { status, version: proxyVersionText?.trim() || 'unknown' }
}

/**
 * Get session count from dashboard
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<number|null>} Returns null if admin access is denied or can't get count
 */
export async function getSessionCountFromDashboard(page) {
  console.log('📊 Getting session count from dashboard')

  try {
    // Wait for sessions card
    await expect(page.locator('text=Active Sessions')).toBeVisible({ timeout: 10000 })

    // Click "Update now" to ensure fresh data (updates both health and session count)
    const updateButton = page.getByRole('button', { name: 'Update now' })
    await expect(updateButton).toBeVisible({ timeout: 5000 })
    await updateButton.click()

    // Wait for loading
    await page.waitForTimeout(2000)

    // Go up two levels: span -> flex div -> card container
    const sessionsCard = page.locator('text=Active Sessions').locator('../..')

    // Check for error (admin access required)
    const errorBanner = page.locator('text=/Admin access required|Authentication required/i')
    if (await errorBanner.isVisible().catch(() => false)) {
      console.log('⚠️ Admin access denied')
      return null
    }

    // Get count - look for the large bold number (text-2xl font-bold)
    const countElement = sessionsCard.locator('.text-2xl.font-bold').first()
    await expect(countElement).toBeVisible({ timeout: 5000 })
    const countText = await countElement.textContent({ timeout: 5000 })
    const count = parseInt(countText?.trim() || '0', 10)

    if (isNaN(count)) {
      console.log('⚠️ Could not parse session count')
      return null
    }

    // 0 is now a valid value (not showing — anymore)
    console.log(`✅ Session count: ${count}`)
    return count
  } catch (e) {
    console.log(`⚠️ Error getting session count: ${e.message}`)
    return null
  }
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
  await expect(page.locator('text=Activity Log')).toBeVisible()
  console.log('✅ Verified on dashboard page')
}

/**
 * Check if admin access is working (no auth errors)
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<boolean>}
 */
export async function hasAdminAccess(page) {
  try {
    // Wait a moment for any errors to appear
    await page.waitForTimeout(2000)

    // Check for error banners
    const errorBanner = page.locator('.bg-red-50, .bg-red-900\\/50').filter({ hasText: /Admin access required|Authentication required/i })
    const hasError = await errorBanner.isVisible().catch(() => false)

    if (hasError) {
      console.log('⚠️ Admin access NOT available')
      return false
    }

    // Check if session count shows a number - 0 is now valid
    // Go up two levels: span -> flex div -> card container
    const sessionCount = page.locator('text=Active Sessions').locator('../..').locator('.text-2xl.font-bold')
    await expect(sessionCount).toBeVisible({ timeout: 5000 })
    const countText = await sessionCount.textContent({ timeout: 5000 })
    const count = parseInt(countText?.trim() || '', 10)

    if (countText === null || isNaN(count)) {
      console.log('⚠️ Admin access appears limited')
      return false
    }

    console.log('✅ Admin access confirmed')
    return true
  } catch (e) {
    console.log(`⚠️ Admin access check failed: ${e.message}`)
    return false
  }
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
 * Clear the activity log via the Clear button
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function clearActivityLog(page) {
  console.log('🧹 Clearing activity log')
  const clearButton = page.locator('text=Activity Log').locator('..').getByRole('button', { name: 'Clear' })
  await clearButton.click()
  await page.waitForTimeout(500)
  console.log('✅ Activity log cleared')
}

/**
 * Get activity log entries
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<Array<{time: string, message: string}>>}
 */
export async function getActivityLogEntries(page) {
  // Wait for the activity log to populate
  await page.waitForTimeout(2000)

  // Find entries by looking for spans with timestamp format (HH:MM:SS)
  // These are the first span in each log entry
  const timestampSpans = page.locator('span').filter({ hasText: /^\d{2}:\d{2}:\d{2}$/ })
  const count = await timestampSpans.count()

  const logEntries = []
  for (let i = 0; i < count; i++) {
    const span = timestampSpans.nth(i)
    const parent = span.locator('..')
    const text = await parent.textContent().catch(() => '')
    if (text && text.trim()) {
      logEntries.push({ text: text.trim() })
    }
  }

  console.log(`📋 Found ${logEntries.length} activity log entries`)
  return logEntries
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
