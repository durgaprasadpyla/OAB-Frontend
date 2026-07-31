import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend is a standalone app, independent of the backend.
//   • `npm run dev`   → dev server on :5173 (talks to VITE_API_BASE; see .env)
//   • `npm run build` → static bundle in ./dist, host it on any server/CDN
// It reaches the backend REST API cross-origin via VITE_API_BASE.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BACKEND = env.VITE_BACKEND_URL || env.VITE_API_BASE || 'http://localhost:8080'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Dev fallback used only if VITE_API_BASE is left empty: forward API calls to the backend.
      proxy: {
        '/rest': { target: BACKEND, changeOrigin: true },
        '/api': { target: BACKEND, changeOrigin: true },
        '/h2-console': { target: BACKEND, changeOrigin: true },
      },
    },
    build: { outDir: 'dist', emptyOutDir: true },
    preview: { port: 4173 },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      css: false,
      include: ['src/**/*.test.{js,jsx}'],
    },
  }
})
