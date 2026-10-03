import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this under /skrim-hackspire/, not at the root. The
  // deploy workflow sets BASE_PATH; locally it stays "/".
  base: process.env.BASE_PATH ?? '/',
})
