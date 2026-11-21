import { describe, expect, it } from 'vitest'
import { markerRadiusPx } from './cameraDistance'
import { trainRadiusPx } from './trainSize'

describe('trainRadiusPx', () => {
  it('is half a station marker from Midtown in', () => {
    expect(trainRadiusPx(1_000)).toBeCloseTo(markerRadiusPx(1_000) * 0.5)
    expect(trainRadiusPx(6_000)).toBeCloseTo(markerRadiusPx(6_000) * 0.5)
  })

  it('is a full marker at the overview and never below 2 px', () => {
    expect(trainRadiusPx(76_000)).toBeCloseTo(markerRadiusPx(76_000))
    expect(trainRadiusPx(76_000)).toBeGreaterThanOrEqual(2.5)
    expect(trainRadiusPx(159_000)).toBeGreaterThanOrEqual(2)
    expect(trainRadiusPx(1_000_000)).toBe(2)
  })

  it('does not jump between the two regimes', () => {
    const samples = [5_000, 6_000, 10_000, 20_000, 30_000, 40_000].map(trainRadiusPx)
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i]! - samples[i - 1]!)).toBeLessThan(1.5)
  })
})
