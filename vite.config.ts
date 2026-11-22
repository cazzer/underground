import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

const TILES = '/underground/basemap/tiles/'

/** Dev server only: a tile that is not in public/basemap/tiles answers 404, as Pages does, instead of the SPA fallback's
 *  index.html with status 200. Runs before Vite's own middlewares, so it checks the file itself. */
function missingTiles404(): Plugin {
  return {
    name: 'missing-tiles-404',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(TILES)) return next()
        const rel = decodeURIComponent(req.url.slice(TILES.length).split('?')[0] ?? '')
        if (!rel.includes('..') && existsSync(join(server.config.publicDir, 'basemap/tiles', rel))) return next()
        res.statusCode = 404
        res.end()
      })
    },
  }
}

export default defineConfig({
  base: '/underground/',
  plugins: [react(), tailwindcss(), missingTiles404()],
  build: { chunkSizeWarningLimit: 1500 }, // three.js alone is ~700 kB
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
