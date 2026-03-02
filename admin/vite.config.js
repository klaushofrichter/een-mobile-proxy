import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { cspPlugin } from './vite-plugin-csp.js'

export default defineConfig({
  plugins: [vue(), tailwindcss(), cspPlugin()],
  base: '/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
