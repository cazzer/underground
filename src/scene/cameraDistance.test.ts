import { describe, expect, it } from 'vitest'
import { markerRadiusPx, screenScale } from './cameraDistance'

describe('markerRadiusPx', () => {
  it('clamps at both ends', () => {
    expect(markerRadiusPx(150_000)).toBe(2)
    expect(markerRadiusPx(400_000)).toBe(2)
    expect(markerRadiusPx(4_000)).toBe(7)
    expect(markerRadiusPx(100)).toBe(7)
  })

  it('shrinks monotonically as the camera pulls back', () => {
    const samples = [5_000, 8_000, 20_000, 76_000, 140_000].map(markerRadiusPx)
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeLessThan(samples[i - 1]!)
  })

  it('is halfway at the geometric midpoint', () => {
    expect(markerRadiusPx(Math.sqrt(150_000 * 4_000))).toBeCloseTo(4.5)
  })
})

describe('screenScale', () => {
  it('grows with distance', () => {
    expect(screenScale(10_000, 4, 1)).toBeGreaterThan(screenScale(1_000, 4, 1))
  })

  it('never goes below the minimum size', () => {
    expect(screenScale(1, 4, 6)).toBe(6)
  })
})
