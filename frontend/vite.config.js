import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Dev server only. In production the frontend is served by nginx from the same
// origin as the API (see nginx.conf), so no proxy and no CORS are involved.
// VITE_API_TARGET points the proxy at another backend (e.g. the Docker image on
// http://localhost:85) and VITE_API_AUTH="user:password" sends its basic auth.
const api = {
  target: process.env.VITE_API_TARGET || 'http://localhost:8000',
  changeOrigin: true,
  ...(process.env.VITE_API_AUTH ? { auth: process.env.VITE_API_AUTH } : {}),
}

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    proxy: { '/rag': api, '/query': api, '/db': api, '/health': api },
  },
})
