import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'

// Load environment variables from .env
config()

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60000,
  maxFailures: 1,

  use: {
    baseURL: 'http://127.0.0.1:3333',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // The admin SPA is served by the proxy on port 3333.
  // Build the admin app, then start the proxy which serves admin/dist as static assets.
  webServer: {
    command: 'npm run build && cd ../proxy && npm run dev',
    url: 'http://127.0.0.1:3333/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
