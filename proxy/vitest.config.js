import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

/**
 * Vitest configuration for Cloudflare Workers tests
 *
 * IMPORTANT: Test environment requirements:
 * - ENVIRONMENT must be 'development' for redirect URI validation tests to pass
 *   (http://127.0.0.1:3333 is only auto-allowed in development mode)
 * - ALLOWED_ORIGINS defines which origins pass CORS/redirect validation
 * - If running in CI/CD, ensure these bindings match this configuration
 */
export default defineWorkersConfig({
  test: {
    setupFiles: ['./test/setup.js'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          kvNamespaces: ['EEN_OAUTH_SESSIONS'],
          bindings: {
            CLIENT_ID: 'test-client-id',
            CLIENT_SECRET: 'test-client-secret',
            ADMIN_EMAILS: 'admin@example.com',
            // Origins allowed for CORS and redirect_uri validation in tests
            ALLOWED_ORIGINS: 'http://localhost:5173',
            // MUST be 'development' - some tests depend on auto-allowed origins
            // (e.g., http://127.0.0.1:3333 regression test)
            ENVIRONMENT: 'development'
          }
        }
      }
    }
  }
})
