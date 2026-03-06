import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/health': 'http://localhost:8000',
      '/ontology': 'http://localhost:8000',
      '/generator': 'http://localhost:8000',
      '/executor': 'http://localhost:8000',
      '/reports': 'http://localhost:8000',
      '/business-data': 'http://localhost:8000',
      '/library': 'http://localhost:8000',
      '/api-keys': 'http://localhost:8000',
    },
  },
})
