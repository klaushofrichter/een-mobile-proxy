/**
 * Admin Login and Health Check Tests
 *
 * Tests the admin OAuth login flow and proxy health monitoring:
 * 1. Login to admin dashboard
 * 2. Verify proxy health is OK
 * 3. Verify dashboard displays correctly
 * 4. Logout flow
 */

import { test, expect } from '@playwright/test'
import {
  loginToAdmin,
  logoutFromAdmin,
  checkHealthFromDashboard,
  getSessionCountFromDashboard,
  clearAppState,
  verifyOnDashboard,
  getProxyUrl,
  MAX_TEST_TIMEOUT
} from './utils.js'

test.describe('Admin Login and Health', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing state before each test
    await page.goto('/')
    await clearAppState(page)
  })

  test('should display login page correctly', async ({ page }) => {
    console.log('\n▶️ Running Test: Login page display\n')

    await page.goto('/')

    // Verify login page elements
    await expect(page.getByRole('heading', { name: 'EEN OAuth Admin' })).toBeVisible()
    await expect(page.getByText('Sign in to manage the OAuth proxy')).toBeVisible()
    await expect(page.getByText('Admin access is restricted')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })).toBeVisible()

    // Verify version is displayed
    const versionLink = page.locator('a').filter({ hasText: /v\d+\.\d+\.\d+/ })
    await expect(versionLink).toBeVisible()
    console.log('✅ Login page displayed correctly')

    console.log('\n✅ Login page display test completed!\n')
  })

  test('should complete full login and verify dashboard', async ({ page }) => {
    console.log('\n▶️ Running Test: Full login and dashboard verification\n')
    test.setTimeout(MAX_TEST_TIMEOUT)

    // Login to admin
    await loginToAdmin(page)

    // Verify we're on the dashboard
    await verifyOnDashboard(page)

    // Verify header shows logged in user
    await expect(page.locator('text=Logged in as')).toBeVisible()
    console.log('✅ Dashboard header shows logged in status')

    // Verify admin version is shown in header
    await expect(page.locator('text=Admin v')).toBeVisible()
    console.log('✅ Admin version shown in header')

    console.log('\n✅ Full login and dashboard verification completed!\n')
  })

  test('should verify proxy health is OK', async ({ page }) => {
    console.log('\n▶️ Running Test: Proxy health verification\n')
    test.setTimeout(MAX_TEST_TIMEOUT)

    // Login to admin
    await loginToAdmin(page)

    // Wait for dashboard to load
    await verifyOnDashboard(page)

    // Check health
    const health = await checkHealthFromDashboard(page)

    // Verify health is OK
    expect(health.status).toBe('ok')
    console.log(`✅ Proxy health is OK`)

    // Verify proxy URL is displayed
    const proxyUrl = getProxyUrl()
    await expect(page.locator(`text=${proxyUrl}`)).toBeVisible()
    console.log(`✅ Proxy URL displayed: ${proxyUrl}`)

    // Verify "Healthy" status indicator
    await expect(page.locator('text=Healthy')).toBeVisible()
    console.log('✅ Healthy status indicator visible')

    console.log('\n✅ Proxy health verification completed!\n')
  })

  test('should display session count', async ({ page }) => {
    console.log('\n▶️ Running Test: Session count display\n')
    test.setTimeout(MAX_TEST_TIMEOUT)

    // Login to admin
    await loginToAdmin(page)

    // Get session count (may be null if admin access not available)
    const sessionCount = await getSessionCountFromDashboard(page)

    // Skip if admin access not available (returns null)
    if (sessionCount === null) {
      console.log('⚠️ SKIPPING: Admin access not available for session count')
      console.log('Ensure TEST_USER email is in ADMIN_EMAILS in proxy config')
      test.skip()
      return
    }

    // Should have at least 1 session (current user)
    expect(sessionCount).toBeGreaterThanOrEqual(1)
    console.log(`✅ Session count: ${sessionCount} (at least 1 expected)`)

    console.log('\n✅ Session count display test completed!\n')
  })

  test('should display version info card', async ({ page }) => {
    console.log('\n▶️ Running Test: Version info display\n')
    test.setTimeout(MAX_TEST_TIMEOUT)

    // Login to admin
    await loginToAdmin(page)

    // Verify Version Info card
    await expect(page.locator('text=Version Info')).toBeVisible()

    // Verify Admin App version is shown
    const versionCard = page.locator('text=Version Info').locator('..').locator('..')
    await expect(versionCard.locator('text=Admin App:')).toBeVisible()
    await expect(versionCard.locator('text=Proxy:')).toBeVisible()
    console.log('✅ Version info card displayed')

    console.log('\n✅ Version info display test completed!\n')
  })

  test('should complete full logout flow', async ({ page }) => {
    console.log('\n▶️ Running Test: Full logout flow\n')
    test.setTimeout(MAX_TEST_TIMEOUT)

    // Login to admin
    await loginToAdmin(page)

    // Verify on dashboard
    await verifyOnDashboard(page)

    // Logout
    await logoutFromAdmin(page)

    // Verify back on login page
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })).toBeVisible()
    console.log('✅ Back on login page')

    console.log('\n✅ Full logout flow test completed!\n')
  })

  test('should show error with wrong password', async ({ page }) => {
    console.log('\n▶️ Running Test: Wrong password login\n')
    test.setTimeout(MAX_TEST_TIMEOUT)

    await page.goto('/')

    // Click sign in button
    await page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' }).click()
    console.log('👆 Clicked Sign in button')

    // Import loginWithEEN for custom password
    const { loginWithEEN } = await import('./utils.js')
    await loginWithEEN(page, 'wrong-password-12345')

    // Should stay on EEN page with error
    await page.waitForTimeout(3000)

    const currentUrl = page.url()
    expect(currentUrl).toMatch(/eagleeyenetworks\.com/)
    console.log('✅ Still on EEN page (login failed as expected)')

    console.log('\n✅ Wrong password test completed!\n')
  })

  test('should reject non-admin users with proper error message', async ({ page }) => {
    console.log('\n▶️ Running Test: Non-admin user rejection\n')
    test.setTimeout(MAX_TEST_TIMEOUT * 2)

    // Check if non-admin credentials are configured
    const { hasNonAdminCredentials, attemptNonAdminLogin } = await import('./utils.js')
    if (!hasNonAdminCredentials()) {
      console.log('⚠️ SKIPPING: TEST_NON_ADMIN_USER and TEST_NON_ADMIN_PASSWORD not configured')
      console.log('To run this test, add non-admin credentials to .env')
      test.skip()
      return
    }

    // Attempt login with non-admin user
    const wasRejected = await attemptNonAdminLogin(page)

    // Verify user was properly rejected
    expect(wasRejected).toBe(true)

    // Verify error message is displayed
    const errorMessage = page.locator('.bg-red-50')
    await expect(errorMessage).toBeVisible()
    const errorText = await errorMessage.textContent()
    expect(errorText.toLowerCase()).toContain('admin')
    console.log('✅ Non-admin rejection error message displayed')

    // Verify user is NOT on dashboard
    expect(page.url()).not.toContain('/dashboard')
    console.log('✅ Non-admin user cannot access dashboard')

    console.log('\n✅ Non-admin user rejection test completed!\n')
  })
})
