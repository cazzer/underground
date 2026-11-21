import { describe, expect, it } from 'vitest'
import { interiorOpacity, REVEAL_FAR, REVEAL_NEAR } from './interiorReveal'

describe('interiorOpacity', () => {
  it('is hidden at and beyond the far distance', () => {
    expect(REVEAL_FAR).toBe(320)
    expect(interiorOpacity(320)).toBe(0)
    expect(interiorOpacity(1000)).toBe(0)
  })

  it('is fully shown from the full-tilt distance in', () => {
    expect(REVEAL_NEAR).toBe(180)
    for (const d of [180, 40, 0]) expect(interiorOpacity(d)).toBe(1)
  })

  it('is half at the log midpoint', () => {
    expect(interiorOpacity(Math.sqrt(180 * 320))).toBeCloseTo(0.5)
  })

  it('decreases strictly across the fade', () => {
    const values = [200, 230, 260, 290, 310].map(interiorOpacity)
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeLessThan(values[i - 1]!)
  })

  it('never returns NaN', () => {
    for (const d of [Number.NaN, Infinity, -1]) expect(Number.isNaN(interiorOpacity(d))).toBe(false)
  })
})
