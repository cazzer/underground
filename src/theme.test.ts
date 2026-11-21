import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { contrastRatio, routeLineColor } from './lib/routeColor'

describe('status tokens', () => {
  it('read at 4.5:1 on every theme background', async () => {
    // theme.ts resolves the active theme from window.location on import; tests run in node.
    vi.stubGlobal('window', { location: { search: '' } })
    const { THEMES } = await import('./theme')
    vi.unstubAllGlobals()
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
