import { describe, expect, it } from 'vitest'
import { DEFAULT_TILT, ISO_POLAR, tiltForDistance } from './tilt'

describe('tiltForDistance', () => {
  const { farDistance, nearDistance } = DEFAULT_TILT

  it('is top-down at and beyond the far distance', () => {
    expect(tiltForDistance(farDistance)).toBe(0)
    expect(tiltForDistance(farDistance * 10)).toBe(0)
  })

  it('is fully tilted at and inside the near distance', () => {
    expect(tiltForDistance(nearDistance)).toBeCloseTo(ISO_POLAR, 10)
    expect(tiltForDistance(1)).toBeCloseTo(ISO_POLAR, 10)
  })

  it('is half-tilted at the log-midpoint', () => {
    const mid = Math.sqrt(farDistance * nearDistance)
    expect(tiltForDistance(mid)).toBeCloseTo(ISO_POLAR / 2, 6)
  })

  it('increases monotonically as the camera approaches', () => {
    let prev = -1
    for (let d = farDistance; d >= nearDistance; d -= 20) {
      const a = tiltForDistance(d)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })

  it('stays within [0, maxPolar]', () => {
    for (const d of [0, 50, 300, 900, 5000]) {
      const a = tiltForDistance(d)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(ISO_POLAR + 1e-12)
    }
  })
})
