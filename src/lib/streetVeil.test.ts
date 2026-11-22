import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import type { Rgb } from './lineBuffers'
import { contrastRatio } from './routeColor'
import { STREET_OVER_VEIL_CONTRAST, streetColorScale, veiledStreetHex } from './streetVeil'

// A gray stroke on a navy ground, like the theme's (theme.test.ts checks the real tokens).
const STROKE = '#646468'
const GROUND = '#0b1f3f'

const linear = (hex: string): Rgb => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

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

describe('streetColorScale', () => {
  const stroke = linear(STROKE)
  const veiled = linear(veiledStreetHex(STROKE, GROUND))

  it('is no change at weight 0 and lands on the veiled color at weight 1', () => {
    const out = { r: 0, g: 0, b: 0 }
    streetColorScale(out, stroke, veiled, 0)
    expect(out).toEqual({ r: 1, g: 1, b: 1 })
    streetColorScale(out, stroke, veiled, 1)
    expect(stroke[0] * out.r).toBeCloseTo(veiled[0])
    expect(stroke[1] * out.g).toBeCloseTo(veiled[1])
    expect(stroke[2] * out.b).toBeCloseTo(veiled[2])
  })

  it('dims monotonically and clamps its weight', () => {
    const half = { r: 0, g: 0, b: 0 }
    const full = { r: 0, g: 0, b: 0 }
    const over = { r: 0, g: 0, b: 0 }
    streetColorScale(half, stroke, veiled, 0.5)
    streetColorScale(full, stroke, veiled, 1)
    streetColorScale(over, stroke, veiled, 3)
    expect(half.r).toBeLessThan(1)
    expect(full.r).toBeLessThan(half.r)
    expect(over).toEqual(full)
  })
})
