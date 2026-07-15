import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative base so the built app works from any mount path — the
  // modeling-automation Flask server serves it under /viewer/ in production.
  base: './',
  plugins: [tailwindcss(), react()],
})
