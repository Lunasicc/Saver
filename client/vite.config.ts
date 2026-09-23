import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from localhost, so one ~1 MB bundle is fine and not worth a warning.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    proxy: {
      // Explicitly 127.0.0.1 (not "localhost"): the API binds to the IPv4 loopback,
      // and on Windows "localhost" can resolve to ::1 first, which would refuse.
      '/api': 'http://127.0.0.1:4000',
    },
  },
})
