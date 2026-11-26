/**
 * The amenity marks' look (enp.5, StationAmenities.tsx): an extruded pictogram whose top is `amenityMark` and whose
 * sides are that color times `amenitySideShade` in linear light (the vertex shade the glyph geometry bakes in), on a
 * background plate. Both faces must read on the background, apart from each other, and apart from the other point
 * marks a station can carry.
 */
import { describe, expect, it, vi } from 'vitest'
import { CVD, MIN_CVD_DISTANCE, oklabDistance, simulateCvd } from './lib/colorMetrics'
import { linearToSrgb, srgb01, srgbToLinear } from './lib/lineDim'
import { contrastRatio } from './lib/routeColor'

async function themes() {
  // theme.ts resolves the active theme from window.location on import; tests run in node.
  vi.stubGlobal('window', { location: { search: '' } })
  const { THEMES } = await import('./theme')
  vi.unstubAllGlobals()
  return THEMES
}

const hex = (rgb: readonly number[]) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
/** `color` times `shade` in linear light, back to sRGB hex: how the side faces draw. */
const shaded = (color: string, shade: number) => hex(srgb01(color).map((c) => linearToSrgb(srgbToLinear(c) * shade)))

describe('amenity mark tokens', () => {
  it('read at 3:1 on the background, tops and sides, with the sides a step darker than the tops', async () => {
    for (const t of Object.values(await themes())) {
      const side = shaded(t.amenityMark, t.amenitySideShade)
      expect(contrastRatio(t.amenityMark, t.background), `${t.name} top`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(side, t.background), `${t.name} side ${side}`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(t.amenityMark, side), `${t.name} top vs side`).toBeGreaterThanOrEqual(1.3)
      expect(t.amenitySideShade).toBeGreaterThan(0)
      expect(t.amenitySideShade).toBeLessThan(1)
    }
  })

  it('stand apart from the focus, location, pin, exit and selected-train colors, also as a dichromat sees them', async () => {
    for (const t of Object.values(await themes())) {
      const others = [['focus', t.stationFocus], ['here', t.here], ['placePin', t.placePin], ['exitPath', t.exitPath], ['trainSelectedRim', t.trainSelectedRim]] as const
      for (const [name, color] of others) {
        expect(oklabDistance(t.amenityMark, color), `${t.name} amenityMark vs ${name} ${color}`).toBeGreaterThanOrEqual(0.1)
        for (const [mode, m] of Object.entries(CVD)) {
          const d = oklabDistance(simulateCvd(t.amenityMark, m), simulateCvd(color, m))
          expect(d, `${t.name} ${mode} amenityMark vs ${name} ${color}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
        }
      }
    }
  })
})
