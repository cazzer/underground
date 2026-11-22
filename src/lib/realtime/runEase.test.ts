import { describe, expect, it } from 'vitest'
import { easeRun, MAX_CRUISE_MPS, rampShareFor, RUN_PEAK_FACTOR, RUN_RAMP_SHARE } from './runEase'

const N = 10_000
const speedAt = (u: number, a?: number): number => (easeRun(u + 0.5 / N, a) - easeRun(u - 0.5 / N, a)) * N

describe('easeRun', () => {
  it('starts at 0, ends at 1 and clamps outside the run', () => {
    for (const a of [undefined, 0.07, 0]) {
      expect(easeRun(0, a)).toBe(0)
      expect(easeRun(1, a)).toBe(1)
      expect(easeRun(-3, a)).toBe(0)
      expect(easeRun(4, a)).toBe(1)
      expect(easeRun(NaN, a)).toBe(0)
    }
  })

  it('never goes backward and is continuous, at any ramp share', () => {
    for (const a of [RUN_RAMP_SHARE, 0.13, 0.01, 0]) {
      let prev = 0
      for (let k = 1; k <= N; k++) {
        const f = easeRun(k / N, a)
        expect(f).toBeGreaterThanOrEqual(prev)
        expect(f - prev).toBeLessThanOrEqual((1 / (1 - a) / N) * (1 + 1e-9))
        prev = f
      }
    }
  })

  it('is half way at half time, by symmetry', () => {
    expect(easeRun(0.5)).toBeCloseTo(0.5, 12)
    for (const u of [0.05, 0.13, 0.31]) expect(easeRun(1 - u)).toBeCloseTo(1 - easeRun(u), 12)
  })

  it('starts and stops at rest, ramps over 20% each end and cruises at 1.25x the average', () => {
    expect(RUN_RAMP_SHARE).toBe(0.2)
    expect(RUN_PEAK_FACTOR).toBeCloseTo(1.25, 12)
    expect(speedAt(0.5 / N)).toBeLessThan(0.01)
    expect(speedAt(1 - 0.5 / N)).toBeLessThan(0.01)
    expect(speedAt(RUN_RAMP_SHARE / 2)).toBeCloseTo(RUN_PEAK_FACTOR / 2, 3)
    for (const u of [0.21, 0.5, 0.79]) expect(speedAt(u)).toBeCloseTo(RUN_PEAK_FACTOR, 3)
    let peak = 0
    for (let k = 1; k < N; k++) peak = Math.max(peak, speedAt(k / N))
    expect(peak).toBeLessThanOrEqual(RUN_PEAK_FACTOR + 1e-6)
  })

  it('runs at constant speed with no ramps', () => {
    for (const u of [0.01, 0.3, 0.99]) expect(easeRun(u, 0)).toBe(u)
  })
})

describe('rampShareFor', () => {
  it('keeps the full ramps while their cruise is under the cap', () => {
    expect(rampShareFor(1000, 70)).toBeCloseTo(RUN_RAMP_SHARE, 12) // 14.3 m/s average, 17.9 m/s cruise
    expect(rampShareFor(0, 70)).toBeCloseTo(RUN_RAMP_SHARE, 12)
  })

  it('shortens the ramps so a fast hop cruises at the cap, and drops them when even the average is over it', () => {
    // 1000 m in 45 s: 22.2 m/s average, which full ramps would cruise at 27.8 m/s.
    const a = rampShareFor(1000, 45)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(RUN_RAMP_SHARE)
    expect(1000 / 45 / (1 - a)).toBeCloseTo(MAX_CRUISE_MPS, 9)
    expect(rampShareFor(1000, 30)).toBe(0) // 33 m/s average
  })
})
