import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { RoutesFile } from './data/schema'
import { colorDistance, oklabDistance } from './lib/colorMetrics'
import { contrastRatio, routeLineColor } from './lib/routeColor'

async function themes() {
  // theme.ts resolves the active theme from window.location on import; tests run in node.
  vi.stubGlobal('window', { location: { search: '' } })
  const { THEMES } = await import('./theme')
  vi.unstubAllGlobals()
  return THEMES
}

const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes

const ROADS = ['highway', 'major', 'minor', 'path'] as const
/** The faintest road still reads on the background. */
const PATH_CONTRAST_MIN = 1.3
/** The road steps: major at least this, minor at most this. */
const MAJOR_CONTRAST_MIN = 1.95
const MINOR_CONTRAST_MAX = 1.5
/** Water and park outlines read, yet stay under the route lines. */
const AREA_CONTRAST_MIN = 1.5
const AREA_CONTRAST_MAX = 2.5
/** sRGB distance from the colors a basemap stroke must never pass for. */
const MIN_MARKER_DISTANCE = 60
/** OKLab distance from the grid, and between water, parks and roads. */
const MIN_OKLAB = 0.05

describe('basemap tokens', () => {
  it('draw roads fainter than the station streets and every drawn route line, highway down to path', async () => {
    for (const t of Object.values(await themes())) {
      const c = (hex: string) => contrastRatio(hex, t.background)
      const lines = routes.map((r) => routeLineColor(`#${r.color}`, t.routeLineMix, t.background))
      const faintestLine = Math.min(...lines.map(c))
      for (const road of ROADS) {
        const stroke = t.basemap[road].stroke
        expect(c(stroke), `${road} ${stroke} vs street`).toBeLessThan(c(t.streetStroke))
        expect(c(stroke), `${road} ${stroke} vs lines`).toBeLessThan(faintestLine)
      }
      for (let i = 1; i < ROADS.length; i++) {
        expect(c(t.basemap[ROADS[i - 1]!].stroke), `${ROADS[i - 1]} over ${ROADS[i]}`).toBeGreaterThan(c(t.basemap[ROADS[i]!].stroke))
      }
      expect(c(t.basemap.path.stroke)).toBeGreaterThanOrEqual(PATH_CONTRAST_MIN)
      // Steps wide enough to read apart: major about 2:1, minor about 1.45:1.
      expect(c(t.basemap.major.stroke)).toBeGreaterThanOrEqual(MAJOR_CONTRAST_MIN)
      expect(c(t.basemap.minor.stroke)).toBeLessThanOrEqual(MINOR_CONTRAST_MAX)
      // Highways read apart from major roads by tone as well as lightness.
      expect(oklabDistance(t.basemap.highway.stroke, t.basemap.major.stroke)).toBeGreaterThanOrEqual(MIN_OKLAB)
    }
  })

  it('draw every class at 1 px: a wider stroke marks only the subway', async () => {
    for (const t of Object.values(await themes())) {
      for (const [cls, { width }] of Object.entries(t.basemap)) {
        expect(width, cls).toBe(1)
        expect(width, cls).toBeLessThan(t.lineWidth)
      }
    }
  })

  it('outline water and parks at 1.5:1 to 2.5:1', async () => {
    for (const t of Object.values(await themes())) {
      for (const area of ['water', 'park'] as const) {
        const c = contrastRatio(t.basemap[area].stroke, t.background)
        expect(c, `${area} ${t.basemap[area].stroke}`).toBeGreaterThanOrEqual(AREA_CONTRAST_MIN)
        expect(c, `${area} ${t.basemap[area].stroke}`).toBeLessThanOrEqual(AREA_CONTRAST_MAX)
      }
    }
  })

  it('stay apart from every drawn route color, the selected rim and the location marker', async () => {
    for (const t of Object.values(await themes())) {
      const drawn = routes.map((r) => [`route ${r.id}`, routeLineColor(`#${r.color}`, t.routeLineMix, t.background)] as const)
      const others = [...drawn, ['rim', t.trainSelectedRim], ['here', t.here]] as const
      for (const [cls, { stroke }] of Object.entries(t.basemap)) {
        for (const [name, color] of others) {
          expect(colorDistance(stroke, color), `${cls} ${stroke} vs ${name} ${color}`).toBeGreaterThanOrEqual(MIN_MARKER_DISTANCE)
        }
      }
    }
  })

  it('stay apart from the grid, and water, parks and roads from each other', async () => {
    for (const t of Object.values(await themes())) {
      for (const [cls, { stroke }] of Object.entries(t.basemap)) {
        for (const [name, grid] of [['gridCell', t.gridCell], ['gridSection', t.gridSection]] as const) {
          expect(oklabDistance(stroke, grid), `${cls} ${stroke} vs ${name} ${grid}`).toBeGreaterThanOrEqual(MIN_OKLAB)
        }
      }
      const groups = [['water', [t.basemap.water.stroke]], ['park', [t.basemap.park.stroke]], ['roads', ROADS.map((r) => t.basemap[r].stroke)]] as const
      for (const [a, as] of groups) {
        for (const [b, bs] of groups) {
          if (a >= b) continue
          for (const x of as) for (const y of bs) expect(oklabDistance(x, y), `${a} ${x} vs ${b} ${y}`).toBeGreaterThanOrEqual(MIN_OKLAB)
        }
      }
    }
  })
})
