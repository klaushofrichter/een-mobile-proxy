/**
 * Helper functions for Playwright tests
 */

import { expect } from '@playwright/test'
import dotenv from 'dotenv'

export const MAX_TEST_TIMEOUT = 60000

/**
 * Navigates to the app's login page
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function navigateToLogin(page) {
  console.log('📝 Navigating to Login page')
  await page.goto('/')
}

/**
 * Get test credentials from environment
 * @returns {{ username: string, password: string }}
 */
export function getTestCredentials() {
  dotenv.config()
  const username = process.env.TEST_USER
  const password = process.env.TEST_PASSWORD
  if (!username || !password) {
    throw new Error('TEST_USER and TEST_PASSWORD must be set in .env')
  }
  return { username, password }
}

/**
 * Handles the EEN OAuth login flow
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} [customPassword] - Optional custom password (for wrong password tests)
 */
export async function loginWithEEN(page, customPassword = null) {
  console.log('🔑 Starting EEN OAuth login')

  const { username, password } = getTestCredentials()
  const passwordToUse = customPassword !== null ? customPassword : password

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
 * Select the appropriate proxy from the dropdown (if visible)
 * Uses VITE_PROXY_URL env var if set, otherwise defaults to localhost
 * Waits for the page to fully render before checking dropdown visibility
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function selectLocalProxy(page) {
  // Wait for the login button to be visible as a signal the page is fully rendered
  await page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' }).waitFor({ state: 'visible', timeout: 5000 })

  // Wait for DOM to stabilize after initial render
  await page.waitForLoadState('domcontentloaded')

  // Now check if proxy dropdown exists and is visible
  const proxySelect = page.locator('#proxy-select')

  if (await proxySelect.isVisible()) {
    const proxyUrl = process.env.VITE_PROXY_URL || 'http://localhost:8787'
    try {
      await proxySelect.selectOption(proxyUrl)
      console.log(`📡 Selected proxy: ${proxyUrl}`)
    } catch (error) {
      // Proxy selection is optional - continue if it fails (e.g., element disappeared)
      console.warn(`⚠️ Could not select proxy ${proxyUrl}: ${error.message}`)
    }
  }
}

/**
 * Full login flow: navigate to login, click sign in, complete EEN OAuth
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function loginToApplication(page) {
  console.log('🔑 Starting full login flow')

  // Navigate to login page
  await navigateToLogin(page)

  // Select local proxy if dropdown is visible
  await selectLocalProxy(page)

  // Click sign in button
  const loginButton = page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })
  await loginButton.click()
  console.log('👆 Clicked Sign in button')

  // Complete EEN OAuth flow
  await loginWithEEN(page)

  // Wait for redirect to profile page
  await page.waitForURL('/profile', { timeout: 25000 })
  console.log('✅ Successfully logged in and redirected to profile')
}

/**
 * Logout from the application
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function logoutFromApplication(page) {
  console.log('🚪 Starting logout')

  // Click revoke & logout button
  const logoutButton = page.getByRole('button', { name: /Revoke & Logout/i })
  await logoutButton.click()

  // Wait for redirect to login page
  await page.waitForURL('/', { timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })).toBeVisible()
  console.log('✅ Successfully logged out')
}

/**
 * Capture credentials from the profile page
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<{ token: string, hostname: string, port: string }>}
 */
export async function captureCredentialsFromProfile(page) {
  console.log('📋 Capturing credentials from profile page')

  // Wait for profile to load
  await expect(page.locator('h3', { hasText: 'Credentials' })).toBeVisible({ timeout: 15000 })

  // Get hostname from input
  const hostnameInput = page.locator('label:has-text("Base URL") + input, label:has-text("Base URL") ~ input').first()
  const hostname = await hostnameInput.inputValue()
  console.log(`✅ Captured hostname: ${hostname}`)

  // Get port from input
  const portInput = page.locator('label:has-text("Port") + input, label:has-text("Port") ~ input').first()
  const port = await portInput.inputValue()
  console.log(`✅ Captured port: ${port}`)

  // Click "Show & Copy" to reveal token
  const showButton = page.getByRole('button', { name: /Show & Copy/i })
  await showButton.click()
  console.log('👆 Clicked Show & Copy')

  // Wait for the input type to change from password to text
  const tokenRow = page.locator('.flex.items-center').filter({ hasText: 'Access Token' })
  await tokenRow.locator('input[type="text"]').waitFor({ state: 'visible', timeout: 5000 })

  // Get token value from the Access Token row
  const token = await tokenRow.locator('input').inputValue()
  console.log(`✅ Captured token: ${token.substring(0, 8)}...`)

  return { token, hostname, port }
}

/**
 * Login using direct access with provided credentials
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {{ token: string, hostname: string, port: string }} credentials
 */
export async function loginWithDirectAccess(page, credentials) {
  console.log('🔐 Starting direct access login')

  // Navigate to direct access page
  await page.goto('/direct')
  await expect(page.getByRole('heading', { name: 'Direct Access' })).toBeVisible()
  console.log('✅ On Direct Access page')

  // Fill in credentials
  await page.getByLabel('Access Token').fill(credentials.token)
  console.log('✅ Entered access token')

  await page.getByLabel('Base URL').fill(credentials.hostname)
  console.log(`✅ Entered hostname: ${credentials.hostname}`)

  await page.getByLabel('Port').fill(credentials.port.toString())
  console.log(`✅ Entered port: ${credentials.port}`)

  // Click Proceed
  await page.getByRole('button', { name: 'Proceed' }).click()
  console.log('👆 Clicked Proceed')
}

/**
 * Refresh the token from the profile page
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function refreshTokenFromProfile(page) {
  console.log('🔄 Refreshing token')

  // Wait for profile to be loaded
  await expect(page.locator('h3', { hasText: 'Credentials' })).toBeVisible({ timeout: 15000 })

  // Click Refresh button
  const refreshButton = page.getByRole('button', { name: 'Refresh' })
  await refreshButton.click()
  console.log('👆 Clicked Refresh button')

  // Wait for refresh to complete (button text changes during refresh)
  await expect(refreshButton).not.toHaveText('Refreshing...', { timeout: 15000 })
  console.log('✅ Token refreshed')
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
