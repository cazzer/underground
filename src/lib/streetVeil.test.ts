import { describe, expect, it } from 'vitest'
import { contrastRatio } from './routeColor'
import { STREET_OVER_VEIL_CONTRAST, veiledStreetHex } from './streetVeil'

// A gray stroke on a navy ground, like the theme's (theme.test.ts checks the real tokens).
const STROKE = '#646468'
const GROUND = '#0b1f3f'

describe('veiledStreetHex', () => {
  it('rests the street stroke at about 1.8 to 2:1 on the background', () => {
    const c = contrastRatio(veiledStreetHex(STROKE, GROUND), GROUND)
    expect(c).toBeGreaterThanOrEqual(1.8)
    expect(c).toBeLessThanOrEqual(2)
    expect(c).toBeCloseTo(STREET_OVER_VEIL_CONTRAST, 1)
  })

  it('leaves a stroke already fainter than the target alone', () => {
    expect(veiledStreetHex(GROUND, GROUND)).toBe(GROUND)
  })
})
