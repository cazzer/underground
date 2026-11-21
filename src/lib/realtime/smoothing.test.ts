import { describe, expect, it } from 'vitest'
import { SMOOTHING, smoothDistance } from './smoothing'

const FRAME = 1 / 60

describe('smoothDistance', () => {
  it('starts at the target and ignores zero time', () => {
    expect(smoothDistance(null, 123, FRAME)).toBe(123)
    expect(smoothDistance(100, 200, 0)).toBe(100)
  })
  it('eases a small error exponentially', () => {
    expect(smoothDistance(0, 10, FRAME)).toBeCloseTo(10 * (1 - Math.exp(-FRAME / SMOOTHING.tauS)))
  })
  it('caps the speed on a large error', () => {
    expect(smoothDistance(0, 1000, FRAME)).toBeCloseTo(SMOOTHING.maxSpeedMps * FRAME)
  })
  it('snaps a huge error either way', () => {
    expect(smoothDistance(0, 2000, FRAME)).toBe(2000)
    expect(smoothDistance(5000, 3000, FRAME)).toBe(3000)
  })
  it('holds rather than moving backward, then snaps past the hold limit', () => {
    expect(smoothDistance(1000, 900, FRAME)).toBe(1000)
    expect(smoothDistance(1000, 500, FRAME)).toBe(500)
  })
  it('converges on a stationary target', () => {
    let d = 0
    for (let i = 0; i < 600; i++) d = smoothDistance(d, 50, FRAME)
    expect(Math.abs(50 - d)).toBeLessThan(0.5)
    expect(d).toBeLessThanOrEqual(50)
  })
  it('trails a moving target by about v*tau and never passes it', () => {
    let target = 1000
    let d = target
    for (let i = 0; i < 600; i++) {
      target += 12 * FRAME
      d = smoothDistance(d, target, FRAME)
      expect(d).toBeLessThanOrEqual(target)
    }
    expect(target - d).toBeLessThanOrEqual(19)
    expect(target - d).toBeGreaterThan(10)
  })
  it('converges at once after a long gap', () => {
    expect(smoothDistance(0, 300, 600)).toBeCloseTo(300, 0)
  })
})
