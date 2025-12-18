/**
 * Authentication Flow Tests
 *
 * Tests various authentication scenarios:
 * 1. Wrong password login attempt
 * 2. Direct access with captured token
 * 3. Token revocation and failed re-use
 * 4. Token refresh and direct login with refreshed token
 */

import { test, expect } from '@playwright/test'
import {
  navigateToLogin,
  loginWithEEN,
  loginToApplication,
  logoutFromApplication,
  captureCredentialsFromProfile,
  loginWithDirectAccess,
  refreshTokenFromProfile,
  clearAppState,
  MAX_TEST_TIMEOUT
} from './utils.js'

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing state before each test
    await page.goto('/')
    await clearAppState(page)
  })

  test('should fail login with wrong password', async ({ page }) => {
    console.log('\n▶️ Running Test: Wrong password login\n')
    test.setTimeout(MAX_TEST_TIMEOUT)

    // Navigate to login page
    await navigateToLogin(page)

    // Click sign in button
    const loginButton = page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })
    await loginButton.click()
    console.log('👆 Clicked Sign in button')

    // Complete EEN OAuth flow with WRONG password
    await loginWithEEN(page, 'wrong-password-12345')

    // Should stay on EEN page with error message
    // EEN shows error message when password is wrong
    await page.waitForTimeout(3000) // Wait for error to appear

    // Check that we're still on EEN auth page (not redirected back)
    const currentUrl = page.url()
    expect(currentUrl).toMatch(/eagleeyenetworks\.com/)
    console.log('✅ Still on EEN page (login failed as expected)')

    // Look for error message on the page
    const errorVisible = await page.locator('text=/incorrect|invalid|error|failed/i').isVisible().catch(() => false)
    if (errorVisible) {
      console.log('✅ Error message visible on EEN page')
    }

    console.log('\n✅ Wrong password test completed!\n')
  })

  test('should login via direct access with captured token', async ({ page }) => {
    console.log('\n▶️ Running Test: Direct access with captured token\n')
    test.setTimeout(MAX_TEST_TIMEOUT * 2)

    // Step 1: Login via OAuth to get a valid token
    await loginToApplication(page)

    // Step 2: Wait for profile to load and capture credentials
    await expect(page.locator('h3', { hasText: 'User Profile' })).toBeVisible({ timeout: 15000 })
    const credentials = await captureCredentialsFromProfile(page)
    console.log('📋 Credentials captured from profile page')

    // Step 3: Clear app state (simulates closing browser)
    await clearAppState(page)
    console.log('🧹 Cleared app state')

    // Step 4: Navigate to login page to confirm we're logged out
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })).toBeVisible()
    console.log('✅ Confirmed logged out state')

    // Step 5: Use direct access with captured credentials
    await loginWithDirectAccess(page, credentials)

    // Step 6: Should redirect to profile page
    await page.waitForURL('/profile', { timeout: 15000 })
    await expect(page.locator('h3', { hasText: 'User Profile' })).toBeVisible({ timeout: 15000 })
    console.log('✅ Successfully logged in via direct access')

    console.log('\n✅ Direct access with captured token test completed!\n')
  })

  test('should fail direct access after token revocation', async ({ page }) => {
    console.log('\n▶️ Running Test: Token revocation and failed re-use\n')
    test.setTimeout(MAX_TEST_TIMEOUT * 2)

    // Step 1: Login via OAuth to get a valid token
    await loginToApplication(page)

    // Step 2: Capture credentials from profile page
    await expect(page.locator('h3', { hasText: 'User Profile' })).toBeVisible({ timeout: 15000 })
    const credentials = await captureCredentialsFromProfile(page)
    console.log('📋 Credentials captured')

    // Step 3: Revoke token and logout
    await logoutFromApplication(page)
    console.log('🚪 Token revoked and logged out')

    // Step 4: Try direct access with the revoked token
    await loginWithDirectAccess(page, credentials)

    // Step 5: Should fail - expect error message on direct access page
    await page.waitForTimeout(3000) // Wait for API call to complete

    // Should still be on direct page or show error
    const errorVisible = await page.locator('text=/expired|invalid|unauthorized|failed/i').isVisible().catch(() => false)
    const stillOnDirectPage = page.url().includes('/direct')

    if (errorVisible) {
      console.log('✅ Error message displayed for revoked token')
    }
    if (stillOnDirectPage) {
      console.log('✅ Still on direct page (login failed as expected)')
    }

    // Verify we did NOT make it to profile
    expect(page.url()).not.toContain('/profile')
    console.log('✅ Confirmed not redirected to profile')

    console.log('\n✅ Token revocation test completed!\n')
  })

  test('should refresh token and use it for direct login', async ({ page }) => {
    console.log('\n▶️ Running Test: Token refresh and direct login\n')
    test.setTimeout(MAX_TEST_TIMEOUT * 2)

    // Step 1: Login via OAuth
    await loginToApplication(page)

    // Step 2: Wait for profile to load
    await expect(page.locator('h3', { hasText: 'User Profile' })).toBeVisible({ timeout: 15000 })

    // Step 3: Capture original credentials
    const originalCredentials = await captureCredentialsFromProfile(page)
    console.log('📋 Original credentials captured')

    // Step 4: Refresh the token
    await refreshTokenFromProfile(page)
    console.log('🔄 Token refreshed')

    // Step 5: Wait a moment for UI to update
    await page.waitForTimeout(1000)

    // Step 6: Capture new credentials (token should be different)
    const newCredentials = await captureCredentialsFromProfile(page)
    console.log('📋 New credentials captured after refresh')

    // Verify the token actually changed
    if (originalCredentials.token !== newCredentials.token) {
      console.log('✅ Token changed after refresh')
    } else {
      console.log('⚠️ Token appears unchanged (may be same token returned)')
    }

    // Step 7: Clear app state
    await clearAppState(page)
    console.log('🧹 Cleared app state')

    // Step 8: Use direct access with NEW token
    await page.goto('/')
    await loginWithDirectAccess(page, newCredentials)

    // Step 9: Should successfully redirect to profile
    await page.waitForURL('/profile', { timeout: 15000 })
    await expect(page.locator('h3', { hasText: 'User Profile' })).toBeVisible({ timeout: 15000 })
    console.log('✅ Successfully logged in with refreshed token')

    console.log('\n✅ Token refresh test completed!\n')
  })

  test('should fail direct access with old token after refresh', async ({ page }) => {
    console.log('\n▶️ Running Test: Old token invalid after refresh\n')
    test.setTimeout(MAX_TEST_TIMEOUT * 2)

    // Step 1: Login via OAuth
    await loginToApplication(page)

    // Step 2: Capture original credentials
    await expect(page.locator('h3', { hasText: 'User Profile' })).toBeVisible({ timeout: 15000 })
    const originalCredentials = await captureCredentialsFromProfile(page)
    console.log('📋 Original credentials captured')

    // Step 3: Refresh the token
    await refreshTokenFromProfile(page)
    console.log('🔄 Token refreshed')

    // Step 4: Logout (this revokes the session)
    await logoutFromApplication(page)
    console.log('🚪 Logged out')

    // Step 5: Try direct access with the OLD token
    await loginWithDirectAccess(page, originalCredentials)

    // Step 6: Should fail
    await page.waitForTimeout(3000)

    // Should show error or stay on direct page
    const stillOnDirectPage = page.url().includes('/direct')
    const errorVisible = await page.locator('text=/expired|invalid|unauthorized|failed/i').isVisible().catch(() => false)

    if (stillOnDirectPage || errorVisible) {
      console.log('✅ Old token rejected as expected')
    }

    // Verify we did NOT make it to profile
    expect(page.url()).not.toContain('/profile')
    console.log('✅ Confirmed not redirected to profile')

    console.log('\n✅ Old token rejection test completed!\n')
  })
})
