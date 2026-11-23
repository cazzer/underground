import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadEnv, type Connect, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import basemapJson from './data/basemap/basemap.json' with { type: 'json' }
import { parseBasemapFile } from './scripts/lib/basemapSpec.ts'
import type { BasemapConfig } from './src/data/basemapConfig'

const BASE = '/underground/'
/** Folders of public/ that are gitignored and built or fetched on demand (basemap tiles, the deploy's dated timetables). */
const BUILT_ON_DEMAND = ['basemap/tiles/', 'data/timetable/dated/']

/** A file in one of those folders that is not under `root` answers 404, as Pages does, instead of the SPA fallback's
 *  index.html with status 200. Runs before Vite's own middlewares, so it checks the file itself. */
function missingFilesMiddleware(root: () => string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url
    if (!url?.startsWith(BASE) || !BUILT_ON_DEMAND.some((p) => url.startsWith(BASE + p))) return next()
    let rel: string
    try {
      rel = decodeURIComponent(url.slice(BASE.length).split('?')[0] ?? '')
    } catch {
      return next() // a malformed escape: leave it to Vite
    }
    if (!rel.includes('..') && existsSync(join(root(), rel))) return next()
    res.statusCode = 404
    res.end()
  }
}

/** `vite serve` answers from public/, `vite preview` from the build (dist, where the deploy puts the dated timetables). */
function missingFiles404(): Plugin {
  return {
    name: 'missing-files-404',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(missingFilesMiddleware(() => server.config.publicDir))
    },
    configurePreviewServer(server) {
      server.middlewares.use(missingFilesMiddleware(() => resolve(server.config.root, server.config.build.outDir)))
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
  plugins: [react(), tailwindcss(), missingFiles404()],
  define: { __BASEMAP__: JSON.stringify(basemapConfig(command === 'serve' && loadEnv(mode, process.cwd(), 'VITE_BASEMAP_DEV').VITE_BASEMAP_DEV === '1')) },
  build: { chunkSizeWarningLimit: 1500 }, // three.js alone is ~700 kB
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
}))
