import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Dev server only. In production the frontend is served by nginx from the same
// origin as the API (see nginx.conf), so no proxy and no CORS are involved.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    proxy: {
      '/rag': 'http://localhost:8000',
      '/query': 'http://localhost:8000',
      '/db': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
})
