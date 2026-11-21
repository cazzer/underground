import { describe, expect, it } from 'vitest'
import { easeSegments, rampBreaks, RAMP_MAX_ERROR_M } from './rampSampling'
import { profileAt, type TrackProfile } from './trackProfile'

const profile = (d: number[], y: number[]): TrackProfile => ({ d: Float64Array.from(d), y: Float64Array.from(y) })

/** Largest |chord - profile| over [from, to] for the drawn breaks. */
function chordError(p: TrackProfile, breaks: number[]): number {
  let worst = 0
  for (let i = 1; i < breaks.length; i++) {
    const a = breaks[i - 1]!
    const b = breaks[i]!
    const ya = profileAt(p, a)
    const yb = profileAt(p, b)
    for (let k = 1; k < 64; k++) {
      const u = k / 64
      worst = Math.max(worst, Math.abs(ya + (yb - ya) * u - profileAt(p, a + (b - a) * u)))
    }
  }
  return worst
}

describe('rampBreaks', () => {
  it('keeps every knot and adds nothing on flat spans', () => {
    const p = profile([0, 100, 400, 500], [-5, -5, -5, -5])
    expect(rampBreaks(p)).toEqual([0, 100, 400, 500])
  })

  it('keeps each ramp within the tolerance for any rise', () => {
    for (const rise of [0.5, 2, 5, 10.2, 20.4, 40, 61]) {
      const p = profile([0, 200, 200 + rise / 0.06, 300 + rise / 0.06], [0, 0, -rise, -rise])
      const b = rampBreaks(p)
      expect(b).toEqual([...b].sort((x, y) => x - y))
      expect(chordError(p, b)).toBeLessThanOrEqual(RAMP_MAX_ERROR_M + 1e-9)
    }
  })

  it("draws Bedford Av's 20.4 m drawn ramp with a handful of vertices, not one every 10 m", () => {
    const n = easeSegments(20.4, RAMP_MAX_ERROR_M)
    expect(n).toBeGreaterThan(1)
    expect(n).toBeLessThanOrEqual(8)
    expect(easeSegments(1, RAMP_MAX_ERROR_M)).toBe(1)
  })

  it('needs more segments for a tighter tolerance', () => {
    expect(easeSegments(20.4, 0.05)).toBeGreaterThan(easeSegments(20.4, 0.25))
  })
})
