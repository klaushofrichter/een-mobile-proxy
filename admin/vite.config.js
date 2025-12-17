import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/een-oauth-proxy/admin/',
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
