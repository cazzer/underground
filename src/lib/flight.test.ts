import { describe, expect, it } from 'vitest'
import { expoInOut, flightDistance, flightDuration, flightProgress, rebasedProgress, remainingPan } from './flight'

describe('expoInOut', () => {
  it('starts at 0, passes through 0.5 at the midpoint, ends at 1', () => {
    expect(expoInOut(0)).toBe(0)
    expect(expoInOut(0.5)).toBeCloseTo(0.5)
    expect(expoInOut(1)).toBe(1)
  })
  it('is slow at both ends and monotone', () => {
    expect(expoInOut(0.1)).toBeLessThan(0.01)
    expect(expoInOut(0.9)).toBeGreaterThan(0.99)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = expoInOut(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
  it('clamps outside [0, 1]', () => {
    expect(expoInOut(-1)).toBe(0)
    expect(expoInOut(2)).toBe(1)
  })
})

describe('flightDuration', () => {
  it('gives a short hop the minimum and caps a city-to-station dive', () => {
    expect(flightDuration(170, 170)).toBeCloseTo(1.2)
    expect(flightDuration(90_000, 170)).toBe(2.4)
    expect(flightDuration(170, 2000)).toBeGreaterThan(1.2)
  })
})

describe('flightProgress', () => {
  it('reaches 1 at the duration and treats a zero duration as done', () => {
    expect(flightProgress(2, 2)).toBe(1)
    expect(flightProgress(3, 2)).toBe(1)
    expect(flightProgress(0, 0)).toBe(1)
  })
})

describe('flightDistance', () => {
  it('interpolates geometrically between the endpoints', () => {
    expect(flightDistance(10_000, 100, 0)).toBeCloseTo(10_000)
    expect(flightDistance(10_000, 100, 1)).toBeCloseTo(100)
    expect(flightDistance(10_000, 100, 0.5)).toBeCloseTo(1000)
  })
})

describe('remainingPan', () => {
  // The destination's screen offset is proportional to (remaining ground offset) / distance.
  const screenOffsets = (d0: number, d1: number): number[] =>
    Array.from({ length: 101 }, (_, i) => {
      const e = expoInOut(i / 100)
      const d = flightDistance(d0, d1, e)
      return remainingPan(d0, d1, d, e) / d
    })

  it('never lets the destination drift further off-center on a dive or a zoom-out', () => {
    for (const [d0, d1] of [[60_000, 170], [2000, 180], [170, 5000]] as const) {
      const offsets = screenOffsets(d0, d1)
      for (let i = 1; i < offsets.length; i++) expect(offsets[i]!).toBeLessThanOrEqual(offsets[i - 1]! * (1 + 1e-9))
      expect(offsets[offsets.length - 1]).toBeCloseTo(0)
    }
  })

  it('starts with the full offset and pans on progress when the zoom barely changes', () => {
    expect(remainingPan(60_000, 170, 60_000, 0)).toBe(1)
    expect(remainingPan(170, 172, 171, 0.25)).toBeCloseTo(0.75)
  })
})

describe('rebasedProgress', () => {
  it('maps the rest of a flight after a retarget onto 0..1', () => {
    expect(rebasedProgress(0.6, 0.6)).toBe(0)
    expect(rebasedProgress(0.8, 0.6)).toBeCloseTo(0.5)
    expect(rebasedProgress(1, 0.6)).toBe(1)
    expect(rebasedProgress(0.3, 0)).toBeCloseTo(0.3)
    expect(rebasedProgress(1, 1)).toBe(1)
  })
})
