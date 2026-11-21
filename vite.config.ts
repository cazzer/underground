import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/underground/',
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1500 }, // three.js alone is ~700 kB
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
