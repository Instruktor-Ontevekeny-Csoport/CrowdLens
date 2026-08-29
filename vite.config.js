import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const __dirname = import.meta.dirname

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin path to the local Supabase stack; avoids cross-origin
    // fetches that some mobile browsers block on private networks.
    proxy: {
      '/sb': {
        target: 'http://127.0.0.1:54321',
        rewrite: (path) => path.replace(/^\/sb/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        moderate: resolve(__dirname, 'moderate/index.html'),
        gallery: resolve(__dirname, 'gallery/index.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
  },
})
