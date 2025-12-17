import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => ({
  plugins: [vue(), tailwindcss()],
  base: command === 'build' ? '/een-oauth-proxy/demo1/' : '/',
  server: {
    host: '127.0.0.1',
    port: 3333,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
}))
