import { describe, expect, it } from 'vitest'
import { DEFAULT_TILT, DEPTH_FLOOR, depthFactor, depthScaleY, ISO_POLAR, tiltForDistance, tiltT } from './tilt'

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

  it('is top-down from 1450 m, visibly tipped by 1250 m and isometric at 400 m', () => {
    const deg = (d: number) => (tiltForDistance(d) * 180) / Math.PI
    expect(farDistance).toBe(1450)
    expect(nearDistance).toBe(400)
    expect(deg(1350)).toBeLessThan(3.5)
    expect(deg(1250)).toBeGreaterThan(8)
    expect(deg(1250)).toBeLessThan(10)
    expect(deg(800)).toBeGreaterThan(35)
    expect(deg(800)).toBeLessThan(40)
  })

  it('has a continuous rate in log-distance: 0 at both ends, no kink where the ease-in hands over', () => {
    const span = Math.log(farDistance / nearDistance)
    const at = (x: number) => tiltT(farDistance * Math.exp(-x * span))
    const rate = (x: number, h = 1e-6) => (at(x + h) - at(x - h)) / (2 * h)
    expect(rate(1e-5)).toBeLessThan(1e-3)
    expect(rate(1 - 1e-5)).toBeLessThan(1e-3)
    const a = DEFAULT_TILT.easeIn
    expect(rate(a - 1e-4)).toBeCloseTo(2, 2)
    expect(rate(a + 1e-4)).toBeCloseTo(2, 2)
    for (let x = 0.01; x < 1; x += 0.01) expect(rate(x)).toBeLessThanOrEqual(2 + 1e-6)
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

describe('tiltT and depthFactor', () => {
  const { farDistance, nearDistance } = DEFAULT_TILT

  it('is 0 top-down and 1 fully tilted, so full tilt keeps the drawn depth as authored', () => {
    expect(tiltT(farDistance)).toBe(0)
    expect(tiltT(farDistance * 3)).toBe(0)
    expect(tiltT(nearDistance)).toBe(1)
    expect(tiltT(1)).toBe(1)
    expect(depthFactor(farDistance)).toBe(0)
    expect(depthFactor(nearDistance)).toBe(1)
  })

  it('is the polar angle as a fraction of the full tilt at every distance', () => {
    for (let d = farDistance + 100; d >= 50; d -= 37) {
      expect(depthFactor(d)).toBeCloseTo(tiltForDistance(d) / ISO_POLAR, 12)
      expect(depthFactor(d)).toBe(tiltT(d))
    }
  })

  it('grows monotonically as the camera approaches', () => {
    let prev = -1
    for (let d = farDistance * 2; d >= nearDistance / 2; d *= 0.97) {
      const t = depthFactor(d)
      expect(t).toBeGreaterThanOrEqual(prev)
      expect(t).toBeLessThanOrEqual(1)
      prev = t
    }
  })

  it('floors an object scale so a flat layer keeps an invertible matrix', () => {
    expect(depthScaleY(0)).toBe(DEPTH_FLOOR)
    expect(depthScaleY(0.5)).toBe(0.5)
    expect(depthScaleY(1)).toBe(1)
  })
})
