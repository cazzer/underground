import { describe, expect, it } from 'vitest'
import { expoInOut, flightDistance, flightDuration, flightProgress } from './flight'

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
