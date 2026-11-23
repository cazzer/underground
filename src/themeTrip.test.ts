/**
 * The trip route's look (TripLines.tsx): under the trip panel the network dims toward the background by
 * `tripNetworkDim`, the list view's first journey draws at `tripFaintDim`, an opened one at full color. The dim is
 * the sRGB mix mixHex makes (lineDim.test.ts holds the shader to it), so these contrasts are what draws.
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

// Floors pinned under the blueprint values measured at tripNetworkDim 0.7 and tripFaintDim 0.35 (2q7.45.3): the
// dimmest dimmed route (SI) reads 1.35:1, the faint line's contrast is at least 1.51x its route's dimmed one, and the
// faintest full route (SI, 3.06:1) is 1.44x the brightest dimmed one (N/Q/R/W, 2.12:1).
const MIN_DIMMED = 1.3
const MIN_FAINT_OVER_DIMMED = 1.45
const MIN_FULL_OVER_DIMMED = 1.4
// The walks and marks (exitPath, 2q7.45.4): 2.66:1 over the dimmed N/Q/R/W, the closest; faint, 3.03:1 on the background.
const MIN_WALK_OVER_DIMMED = 2.5
const MIN_FAINT_WALK = 2.5

describe('trip route tokens', () => {
  it('leave every dimmed route readable, the faint trip clearly above it and every full route above any dimmed one', async () => {
    for (const t of Object.values(await themes())) {
      const drawn = routes.map((r) => ({ id: r.id, color: routeLineColor(`#${r.color}`, t.routeLineMix, t.background) }))
      const on = (c: string, dim: number) => contrastRatio(mixHex(c, t.background, dim), t.background)
      let brightestDimmed = 0
      for (const r of drawn) {
        const dimmed = on(r.color, t.tripNetworkDim)
        brightestDimmed = Math.max(brightestDimmed, dimmed)
        expect(dimmed, `${t.name} ${r.id} dimmed`).toBeGreaterThanOrEqual(MIN_DIMMED)
        expect(on(r.color, t.tripFaintDim) / dimmed, `${t.name} ${r.id} faint over dimmed`).toBeGreaterThanOrEqual(MIN_FAINT_OVER_DIMMED)
      }
      for (const r of drawn) {
        expect(on(r.color, 0) / brightestDimmed, `${t.name} ${r.id} full over the brightest dimmed`).toBeGreaterThanOrEqual(MIN_FULL_OVER_DIMMED)
      }
    }
  })

  it('keep every dimmed route above the equally dimmed basemap and station streets', async () => {
    for (const t of Object.values(await themes())) {
      const on = (hex: string) => contrastRatio(hex, t.background)
      const faintestDimmed = Math.min(
        ...routes.map((r) => on(mixHex(routeLineColor(`#${r.color}`, t.routeLineMix, t.background), t.background, t.tripNetworkDim))),
      )
      // As drawn: the basemap (basemapLayer.ts setVisibility, a class at full strength) and the streets (DIM_GLSL) both mix in sRGB.
      for (const [cls, { stroke }] of Object.entries(t.basemap)) {
        const dimmed = mixHex(stroke, t.background, t.tripNetworkDim)
        expect(on(dimmed), `${t.name} ${cls} ${dimmed}`).toBeLessThan(faintestDimmed)
      }
      const street = mixHex(t.streetStroke, t.background, t.tripNetworkDim)
      expect(on(street), `${t.name} street ${street}`).toBeLessThan(faintestDimmed)
    }
  })

  it("keep the trip's walks and marks readable over the dimmed network, and on the background when faint", async () => {
    for (const t of Object.values(await themes())) {
      const dimmed = routes.map((r) => ({
        id: r.id,
        color: mixHex(routeLineColor(`#${r.color}`, t.routeLineMix, t.background), t.background, t.tripNetworkDim),
      }))
      for (const r of dimmed) expect(contrastRatio(t.exitPath, r.color), `${t.name} walk over dimmed ${r.id}`).toBeGreaterThanOrEqual(MIN_WALK_OVER_DIMMED)
      const faint = mixHex(t.exitPath, t.background, t.tripFaintDim)
      expect(contrastRatio(faint, t.background), `${t.name} faint walk ${faint}`).toBeGreaterThanOrEqual(MIN_FAINT_WALK)
    }
  })

  it('draw the opened trip wider than the network, and dim the network more than the faint trip', async () => {
    for (const t of Object.values(await themes())) {
      expect(t.tripLineWidth).toBeGreaterThan(t.lineWidth)
      expect(t.tripNetworkDim).toBeGreaterThan(t.tripFaintDim)
      expect(t.tripFaintDim).toBeGreaterThan(0)
      expect(t.tripNetworkDim).toBeLessThan(1)
    }
  })
})
