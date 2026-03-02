import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

/**
 * Vitest configuration for Cloudflare Workers tests (Mobile Proxy)
 *
 * IMPORTANT: Test environment requirements:
 * - ENVIRONMENT must be 'development' for redirect URI validation tests to pass
 *   (http scheme is only auto-allowed in development mode)
 * - ALLOWED_SCHEMES defines which custom URL schemes are allowed for mobile redirect URIs
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
            // Custom URL schemes allowed for mobile redirect URIs
            ALLOWED_SCHEMES: 'myapp,myotherapp',
            // MUST be 'development' - some tests depend on auto-allowed schemes
            // (e.g., http scheme for local testing)
            ENVIRONMENT: 'development'
          }
        }
      }
    }
  }
})
