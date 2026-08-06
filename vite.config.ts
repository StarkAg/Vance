import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The dev app is intentionally exposed through ngrok for phone testing.
    allowedHosts: true,
  },
})
