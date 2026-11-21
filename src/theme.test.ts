import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { RoutesFile } from './data/schema'
import { contrastRatio, routeLineColor } from './lib/routeColor'

async function themes() {
  // theme.ts resolves the active theme from window.location on import; tests run in node.
  vi.stubGlobal('window', { location: { search: '' } })
  const { THEMES } = await import('./theme')
  vi.unstubAllGlobals()
  return THEMES
}

describe('status tokens', () => {
  it('read at 4.5:1 on every theme background', async () => {
    const THEMES = await themes()
    for (const t of Object.values(THEMES)) {
      for (const color of [t.statusLive, t.statusWarn, t.statusError]) {
        expect(contrastRatio(color, t.background), `${t.name} ${color}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

/** Straight-line distance between two '#rrggbb' colors in sRGB (0 to about 441). */
function colorDistance(a: string, b: string): number {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [ra, rb] = [rgb(a), rgb(b)]
  return Math.hypot(...ra.map((v, i) => v - rb[i]!))
}

/** Smallest distance that keeps the marker apart from a line color it crosses. */
const MIN_HERE_DISTANCE = 60

describe('here token', () => {
  it('reads at 3:1 on every theme background', async () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const { THEMES } = await import('./theme')
    vi.unstubAllGlobals()
    for (const t of Object.values(THEMES)) {
      expect(contrastRatio(t.here, t.background), t.name).toBeGreaterThanOrEqual(3)
    }
  })

  it('stays apart from the focus color, the train color and every route line as drawn', async () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const { THEMES } = await import('./theme')
    vi.unstubAllGlobals()
    const routes: { id: string; color: string }[] = JSON.parse(
      readFileSync(new URL('../public/data/routes.json', import.meta.url), 'utf8'),
    ).routes
    for (const t of Object.values(THEMES)) {
      const drawn = routes.map((r) => [`route ${r.id}`, routeLineColor(`#${r.color}`, t.routeLineMix, t.background)] as const)
      for (const [name, color] of [...drawn, ['focus', t.stationFocus], ['train', t.train]] as const) {
        expect(colorDistance(t.here, color), `${t.name} here ${t.here} vs ${name} ${color}`).toBeGreaterThanOrEqual(MIN_HERE_DISTANCE)
      }
    }
  })
})

/** OKLab distance (about 0.1 is a clearly different color): rims are told apart from lines by hue, not only lightness. */
function oklabDistance(a: string, b: string): number {
  const lab = (hex: string): number[] => {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
    const k = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * k, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * k, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * k]
  }
  const p = lab(a)
  const q = lab(b)
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!)
}

describe('trainSelectedRim', () => {
  const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes

  it('reads at 3:1 on the background and stands apart from every drawn line color', async () => {
    for (const t of Object.values(await themes())) {
      expect(contrastRatio(t.trainSelectedRim, t.background), t.name).toBeGreaterThanOrEqual(3)
      // Nor may it pass for another marker: the location marker, the focused ring, station rings.
      for (const [name, color] of [['here', t.here], ['focus', t.stationFocus], ['station', t.stationStroke], ['train', t.train]] as const) {
        expect(oklabDistance(t.trainSelectedRim, color), `${t.name} rim vs ${name} ${color}`).toBeGreaterThanOrEqual(0.1)
      }
      const lines = new Set(routes.map((r) => routeLineColor(`#${r.color}`, t.routeLineMix, t.background)))
      for (const line of lines) {
        expect(oklabDistance(t.trainSelectedRim, line), `${t.name} vs ${line}`).toBeGreaterThanOrEqual(0.1)
        // Blueprint and drafting lines span too wide a lightness range (each line is 3:1 on the background)
        // for any color to reach 2:1 against all of them, so there the gap and the hue carry the rim.
        if (t.routeLineMix.amount >= 1) expect(contrastRatio(t.trainSelectedRim, line), `${t.name} vs ${line}`).toBeGreaterThanOrEqual(2)
      }
    }
  })
})
