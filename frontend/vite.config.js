import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/config': 'http://localhost:8000',
      '/rag': 'http://localhost:8000',
      '/query': 'http://localhost:8000',
      '/db': 'http://localhost:8000'
    }
  }
})
