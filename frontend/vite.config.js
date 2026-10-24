import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Local testing against a backend on your laptop:
//   .env.local →  VITE_API_URL=/api
//                 API_PROXY_TARGET=http://127.0.0.1:8000
// The phone talks only to Vite (same origin), and Vite forwards /api/* to uvicorn, so no CORS setup is needed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_PROXY_TARGET
  return {
    plugins: [react(), tailwindcss()],
    server: target
      ? { proxy: { '/api': { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } } }
      : {},
  }
})
