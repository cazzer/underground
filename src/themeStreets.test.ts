/**
 * The street layers' entrance marks (StreetLines.tsx, o3r.5): the focused station's in `interiorEntrance`, a neighbour's
 * in view mixed toward the background by `interiorEntranceNeighbourMix` (sRGB, as mixHex makes it), a dimmer tier that
 * still reads on the background.
 */
import { describe, expect, it, vi } from 'vitest'
import { contrastRatio, mixHex } from './lib/routeColor'

async function themes() {
  // theme.ts resolves the active theme from window.location on import; tests run in node.
  vi.stubGlobal('window', { location: { search: '' } })
  const { THEMES } = await import('./theme')
  vi.unstubAllGlobals()
  return THEMES
}

/** A neighbour's mark still reads on the background. */
const MIN_NEIGHBOUR = 1.5
/** And it is a tier below the focused station's: at most this share of its contrast. */
const MAX_NEIGHBOUR_SHARE = 0.5

describe('neighbour entrance marks', async () => {
  for (const [name, t] of Object.entries(await themes())) {
    it(`${name}: a dimmer tier, at least ${MIN_NEIGHBOUR}:1 on the background`, () => {
      const neighbour = mixHex(t.interiorEntrance, t.background, t.interiorEntranceNeighbourMix)
      const dim = contrastRatio(neighbour, t.background)
      expect(dim).toBeGreaterThanOrEqual(MIN_NEIGHBOUR)
      expect(dim).toBeLessThanOrEqual(MAX_NEIGHBOUR_SHARE * contrastRatio(t.interiorEntrance, t.background))
    })
  }
})
