import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js', 'vite-plugin-csp.test.js'],
    globals: true
  }
})
