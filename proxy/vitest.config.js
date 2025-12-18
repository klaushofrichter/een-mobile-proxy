import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

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
            ALLOWED_ORIGINS: 'http://localhost:5173',
            ENVIRONMENT: 'development'
          }
        }
      }
    }
  }
})
