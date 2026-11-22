import { describe, expect, it } from 'vitest'
import { edgeFade } from '../streetBuffers'
import { maskAlpha, maskInner } from './streetMask'

describe('maskAlpha', () => {
  it('is the exact complement of the station layer at full strength', () => {
    for (const radiusM of [50, 150, 300]) {
      const [inner, outer] = [maskInner(radiusM), radiusM]
      for (let r = 0; r <= radiusM + 50; r += 2.5) {
        // The station layer shows 1 - edgeFade of its stroke; the road keeps the rest.
        expect(maskAlpha(r, inner, outer, 1) + (1 - edgeFade(r, radiusM)), `radius ${radiusM} r ${r}`).toBeCloseTo(1, 9)
      }
    }
  })

  it('scales with the station layer opacity, and leaves roads alone without one', () => {
    const [inner, outer] = [maskInner(300), 300]
    expect(maskAlpha(0, inner, outer, 0.4)).toBeCloseTo(0.6, 12)
    expect(maskAlpha(0, inner, outer, 0)).toBe(1)
    expect(maskAlpha(1000, inner, outer, 1)).toBe(1)
  })

  it('never divides by zero for a radius of 0', () => {
    const [inner, outer] = [maskInner(0), 0]
    expect(maskAlpha(0, inner, outer, 1)).toBe(0)
    expect(maskAlpha(1, inner, outer, 1)).toBe(1)
  })
})
