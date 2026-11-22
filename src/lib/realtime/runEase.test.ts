import { describe, expect, it } from 'vitest'
import { easeRun, RUN_PEAK_FACTOR, RUN_RAMP_SHARE } from './runEase'

const N = 10_000
const speedAt = (u: number): number => (easeRun(u + 0.5 / N) - easeRun(u - 0.5 / N)) * N

describe('easeRun', () => {
  it('starts at 0, ends at 1 and clamps outside the run', () => {
    expect(easeRun(0)).toBe(0)
    expect(easeRun(1)).toBe(1)
    expect(easeRun(-3)).toBe(0)
    expect(easeRun(4)).toBe(1)
    expect(easeRun(NaN)).toBe(0)
  })

  it('never goes backward and is continuous', () => {
    let prev = 0
    for (let k = 1; k <= N; k++) {
      const f = easeRun(k / N)
      expect(f).toBeGreaterThanOrEqual(prev)
      expect(f - prev).toBeLessThanOrEqual((RUN_PEAK_FACTOR / N) * (1 + 1e-9))
      prev = f
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
})
