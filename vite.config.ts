import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import basemapJson from './data/basemap/basemap.json' with { type: 'json' }
import { parseBasemapFile } from './scripts/lib/basemapSpec.ts'
import type { BasemapConfig } from './src/data/basemapConfig'

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

/** Parsed here so a bad basemap.json fails the build, not the page. */
const basemap = parseBasemapFile(basemapJson)

/**
 * What the client may load: a tile pin's spec and release; null for a legacy (single-file) pin or none. Under
 * `vite serve`, VITE_BASEMAP_DEV=1 (e.g. in .env.local) loads the local public/basemap/tiles with version "dev".
 */
function basemapConfig(devTiles: boolean): BasemapConfig | null {
  const { bbox, maxzoom, layers } = basemap.spec
  if (devTiles) return { bbox, maxzoom, layers, version: 'dev' }
  const pin = basemap.pin
  return pin !== null && 'asset' in pin ? { bbox, maxzoom, layers, version: pin.release } : null
}

export default defineConfig(({ command, mode }) => ({
  base: '/underground/',
  plugins: [react(), tailwindcss(), missingTiles404()],
  define: { __BASEMAP__: JSON.stringify(basemapConfig(command === 'serve' && loadEnv(mode, process.cwd(), 'VITE_BASEMAP_DEV').VITE_BASEMAP_DEV === '1')) },
  build: { chunkSizeWarningLimit: 1500 }, // three.js alone is ~700 kB
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
}))
