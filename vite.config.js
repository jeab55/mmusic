import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

// Mmusic on mplus (base55): base = /mmusic/ (override with env VITE_BASE)
export default defineConfig({
  base: process.env.VITE_BASE || '/mmusic/',
  logLevel: 'error',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  plugins: [
    react(),
  ]
});
