/**
 * Happy Path Test - OAuth Login Flow
 *
 * Tests the complete OAuth login flow:
 * 1. Navigate to login page
 * 2. Click "Sign in with Eagle Eye Networks"
 * 3. Complete EEN OAuth login
 * 4. Verify profile page loads with user information
 * 5. Logout and verify return to login page
 */

import { test, expect } from '@playwright/test'
import { loginToApplication, logoutFromApplication, MAX_TEST_TIMEOUT } from './utils.js'

test.describe('Happy Path - OAuth Login Flow', () => {
  test('should complete full login and logout flow', async ({ page }) => {
    console.log(`\n▶️ Running Test: ${test.info().title}\n`)
    test.setTimeout(MAX_TEST_TIMEOUT)

    // Login to the application
    await loginToApplication(page)

    // Verify we're on the profile page
    await expect(page).toHaveURL('/profile')
    console.log('✅ Profile page URL loaded')

    // Wait for profile content to load (not loading or error state)
    // The h3 with "User Profile" appears when profile is loaded successfully
    await expect(page.locator('h3', { hasText: 'User Profile' })).toBeVisible({ timeout: 15000 })
    console.log('✅ User Profile heading visible')

    // Verify credentials section is displayed
    await expect(page.locator('h3', { hasText: 'Credentials' })).toBeVisible()
    console.log('✅ Credentials section visible')

    // Verify access token label exists
    await expect(page.getByText('Access Token', { exact: false })).toBeVisible()
    console.log('✅ Access Token field visible')

    // Verify refresh token shows as available
    await expect(page.locator('input[value="Available"]')).toBeVisible()
    console.log('✅ Refresh token shows as Available')

    // Verify token expiration is displayed
    await expect(page.getByText(/remaining/)).toBeVisible()
    console.log('✅ Token expiration countdown visible')

    // Logout
    await logoutFromApplication(page)

    // Verify we're back on the login page
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'Sign in with Eagle Eye Networks' })).toBeVisible()
    console.log('✅ Back on login page')

    console.log('\n✅ Happy path test completed successfully!\n')
  })

  test('should display correct app title and version', async ({ page }) => {
    console.log(`\n▶️ Running Test: ${test.info().title}\n`)

    // Navigate to login page
    await page.goto('/')

    // Verify app title is displayed
    await expect(page.getByRole('heading', { name: 'EEN OAuth Demo' })).toBeVisible()
    console.log('✅ App title displayed')

    // Verify version link is displayed (contains 'v' followed by version number)
    const versionLink = page.locator('a').filter({ hasText: /v\d+\.\d+\.\d+/ })
    await expect(versionLink).toBeVisible()
    console.log('✅ Version link visible')

    // Verify version links to GitHub
    await expect(versionLink).toHaveAttribute('href', /github\.com/)
    console.log('✅ Version links to GitHub')

    // Verify version format
    const versionText = await versionLink.textContent()
    expect(versionText).toMatch(/v\d+\.\d+\.\d+/)
    console.log(`✅ Version format correct: ${versionText}`)

    console.log('\n✅ App title and version test completed!\n')
  })

  test('should navigate to direct access page', async ({ page }) => {
    console.log(`\n▶️ Running Test: ${test.info().title}\n`)

    // Navigate to login page
    await page.goto('/')

    // Click direct access button
    await page.getByRole('button', { name: 'Direct Access (with token)' }).click()

    // Verify we're on the direct access page
    await expect(page).toHaveURL('/direct')
    await expect(page.getByRole('heading', { name: 'Direct Access' })).toBeVisible()
    console.log('✅ Direct access page loaded')

    // Verify form fields are present
    await expect(page.getByLabel('Access Token')).toBeVisible()
    await expect(page.getByLabel('Base URL')).toBeVisible()
    await expect(page.getByLabel('Port')).toBeVisible()
    console.log('✅ All form fields present')

    // Click back to login
    await page.getByRole('button', { name: 'Back to Login' }).click()
    await expect(page).toHaveURL('/')
    console.log('✅ Back to login page')

    console.log('\n✅ Direct access navigation test completed!\n')
  })
})
