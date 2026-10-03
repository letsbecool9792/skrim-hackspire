import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The extension looks for the dashboard at exactly http://localhost:5173
  // (lib/agent/dashboard-feed.ts). If that port is taken, Vite's default is
  // to move to 5174 silently and the dashboard says "disconnected" for no
  // visible reason. Fail loudly instead.
  server: { port: 5173, strictPort: true },
})
