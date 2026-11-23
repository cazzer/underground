/**
 * A picked service change's look (08r.6, through the trip's route view): the network dims by `tripNetworkDim` as for a
 * trip; a skipped station's ring and cross (TripMarks.tsx) are `changeSkipMark`; a suspended stretch (TripLines.tsx)
 * dashes in its route colour mixed `changeSuspendedDim` toward the background. The mixes are the sRGB ones mixHex
 * makes (lineDim.test.ts holds the shader to it), so these contrasts are what draws.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { contrastRatio, mixHex, routeLineColor } from './lib/routeColor'

async function themes() {
  // theme.ts resolves the active theme from window.location on import; tests run in node.
  vi.stubGlobal('window', { location: { search: '' } })
  const { THEMES } = await import('./theme')
  vi.unstubAllGlobals()
  return THEMES
}

const routes: { id: string; color: string }[] = JSON.parse(readFileSync(new URL('../public/data/routes.json', import.meta.url), 'utf8')).routes

/** The skip mark must read at 3:1 on the background and over every dimmed line (it sits on one); blueprint measures 14.4:1 and 6.76:1 (over the dimmed N). */
const MIN_SKIP = 3
// Floors pinned under the blueprint values measured at changeSuspendedDim 0.35 and tripNetworkDim 0.7 (08r.6): a
// suspended dash is at least 1.51x its route's dimmed contrast (SI, the closest; the faint trip line's ratio, the same
// mix), and the dimmest dash (SI) reads 2.04:1 on the background.
const MIN_SUSPENDED_OVER_DIMMED = 1.45
const MIN_SUSPENDED_ON_BACKGROUND = 2

describe('service change tokens', () => {
  it('keep the skip mark at 3:1 on the background and over every route dimmed by the network dim', async () => {
    for (const t of Object.values(await themes())) {
      expect(contrastRatio(t.changeSkipMark, t.background), `${t.name} skip on background`).toBeGreaterThanOrEqual(MIN_SKIP)
      for (const r of routes) {
        const dimmed = mixHex(routeLineColor(`#${r.color}`, t.routeLineMix, t.background), t.background, t.tripNetworkDim)
        expect(contrastRatio(t.changeSkipMark, dimmed), `${t.name} skip over dimmed ${r.id}`).toBeGreaterThanOrEqual(MIN_SKIP)
      }
    }
  })

  it('draw a suspended stretch clearly above its dimmed route, and readable on the background', async () => {
    for (const t of Object.values(await themes())) {
      for (const r of routes) {
        const color = routeLineColor(`#${r.color}`, t.routeLineMix, t.background)
        const on = (dim: number) => contrastRatio(mixHex(color, t.background, dim), t.background)
        const dash = on(t.changeSuspendedDim)
        expect(dash / on(t.tripNetworkDim), `${t.name} ${r.id} dash over dimmed`).toBeGreaterThanOrEqual(MIN_SUSPENDED_OVER_DIMMED)
        expect(dash, `${t.name} ${r.id} dash on background`).toBeGreaterThanOrEqual(MIN_SUSPENDED_ON_BACKGROUND)
      }
    }
  })

  it('dim a suspended stretch less than the network, with a real dash and gap', async () => {
    for (const t of Object.values(await themes())) {
      expect(t.changeSuspendedDim).toBeGreaterThan(0)
      expect(t.changeSuspendedDim).toBeLessThan(t.tripNetworkDim)
      expect(t.changeSuspendedDashPx).toBeGreaterThan(0)
      expect(t.changeSuspendedGapPx).toBeGreaterThan(0)
    }
  })
})
