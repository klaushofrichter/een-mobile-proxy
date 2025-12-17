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
 * Handles the EEN OAuth login flow
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function loginWithEEN(page) {
  console.log('🔑 Starting EEN OAuth login')

  // Load environment variables
  dotenv.config()

  const username = process.env.TEST_USER
  const password = process.env.TEST_PASSWORD

  if (!username || !password) {
    throw new Error('TEST_USER and TEST_PASSWORD must be set in .env')
  }

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
  await passwordInput.fill(password)
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
export async function loginToApplication(page) {
  console.log('🔑 Starting full login flow')

  // Navigate to login page
  await navigateToLogin(page)

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
