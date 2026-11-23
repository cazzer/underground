import { describe, expect, it } from 'vitest'
import { focusScaleFactor, markerRadiusPx, screenScale, tripMarkRadiusPx } from './cameraDistance'

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

describe('focusScaleFactor', () => {
  it('grows the focused marker 1.4x at map zoom', () => {
    const d = 3_000
    expect(focusScaleFactor(d, screenScale(d, markerRadiusPx(d), 6))).toBeCloseTo(1.4)
  })

  it('stops the growth at 12 px', () => {
    // A 10 px marker may only grow to 12 px.
    expect(focusScaleFactor(1_000, screenScale(1_000, 10, 0))).toBeCloseTo(1.2)
  })

  it('never shrinks the marker below its neighbours when close in', () => {
    expect(focusScaleFactor(170, 6)).toBe(1)
  })
})

describe('tripMarkRadiusPx', () => {
  it('rings the station marker at every distance, held to 5..13 px', () => {
    for (const d of [100, 1_000, 4_000, 20_000, 76_000, 150_000, 400_000]) {
      const r = tripMarkRadiusPx(d)
      expect(r).toBeGreaterThanOrEqual(5)
      expect(r).toBeLessThanOrEqual(13)
      expect(r).toBeGreaterThanOrEqual(markerRadiusPx(d) * 1.4)
    }
  })
})
