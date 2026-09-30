import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { loadSettings } from './scripts/load-settings.mjs'
import { DEFAULTS } from './src/lib/settings.defaults.js'

const __dirname = import.meta.dirname

// Settings are read once, when the dev server or build starts.
async function bakedSettings({ command, mode, isPreview }) {
  if (process.env.VITEST || isPreview) return DEFAULTS
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  // The dev proxy path (/sb) is not reachable from Node.
  const url = env.VITE_SUPABASE_URL?.startsWith('http')
    ? env.VITE_SUPABASE_URL
    : (env.SUPABASE_URL ?? 'http://127.0.0.1:54321')
  // A deployable build must never silently ship default settings.
  const deployBuild =
    env.CI || env.VERCEL || env.CF_PAGES || (command === 'build' && mode === 'production')
  const strict = Boolean(deployBuild) && env.ALLOW_DEFAULT_SETTINGS !== '1'
  return loadSettings({ url, anonKey: env.VITE_SUPABASE_ANON_KEY, strict })
}

export default defineConfig(async (configEnv) => ({
  plugins: [react()],
  define: { __APP_SETTINGS__: JSON.stringify(await bakedSettings(configEnv)) },
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
}))
