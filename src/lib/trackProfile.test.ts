import { describe, expect, it } from 'vitest'
import { buildPolyline } from './realtime/polyline'
import { buildTrackProfile, EMPTY_PROFILE, GRADE, profileAt, resampleForProfile, type TrackProfile } from './trackProfile'
import { RAMP_MAX_ERROR_M } from './rampSampling'

const OPTS = { grade: GRADE, yScale: 1 }
const L = 10.2 / GRADE // 340 m
const one = (yScale = 1): TrackProfile => buildTrackProfile([{ d0: 1000, d1: 1170, yReal: -10.2 }], { grade: GRADE, yScale }).profile
const slope = (p: TrackProfile, d: number, h = 1e-3) => (profileAt(p, d + h) - profileAt(p, d - h)) / (2 * h)

describe('buildTrackProfile / profileAt', () => {
  it('is 0 everywhere with no runs', () => {
    expect(profileAt(EMPTY_PROFILE, -5)).toBe(0)
    expect(profileAt(EMPTY_PROFILE, 1234)).toBe(0)
    expect(buildTrackProfile([], OPTS).profile).toBe(EMPTY_PROFILE)
  })

  it('is flat at the rail height over the run and 0 outside the ramps', () => {
    const p = one()
    for (const d of [1000, 1050, 1170]) expect(profileAt(p, d)).toBeCloseTo(-10.2, 12)
    for (const d of [0, 1000 - L, 1170 + L, 5000]) expect(profileAt(p, d)).toBe(0)
    expect(profileAt(p, 1000 - L / 2)).toBeCloseTo(-5.1, 12)
  })

  it('is continuous with zero slope at the knots', () => {
    const p = one()
    for (const k of p.d) {
      expect(Math.abs(profileAt(p, k + 1e-6) - profileAt(p, k - 1e-6))).toBeLessThan(1e-6)
      expect(Math.abs(slope(p, k))).toBeLessThan(1e-3)
    }
  })

  it('keeps the peak slope at 1.5 times the average and the average at the grade', () => {
    const p = one()
    let peak = 0
    for (let d = 1000 - L; d <= 1000; d += 1) peak = Math.max(peak, Math.abs(slope(p, d)))
    expect(peak).toBeLessThanOrEqual(1.5 * (10.2 / L) + 1e-9)
    expect(peak).toBeGreaterThan(1.49 * (10.2 / L))
    expect((profileAt(p, 1000) - profileAt(p, 1000 - L)) / L).toBeCloseTo(-GRADE, 12)
  })

  it('scales y by yScale but not the ramp length', () => {
    const p = one(2)
    expect(profileAt(p, 1100)).toBeCloseTo(-20.4, 12)
    expect(profileAt(p, 1000 - L)).toBe(0)
    expect(profileAt(p, 1000 - L / 2)).toBeCloseTo(-10.2, 12)
    expect([...p.d]).toEqual([...one(1).d])
  })

  it('eases straight from one run to the next when their ramps would overlap', () => {
    const { profile, dropped } = buildTrackProfile(
      [
        { d0: 1500, d1: 1600, yReal: -6 },
        { d0: 1000, d1: 1100, yReal: -10 },
      ],
      OPTS,
    )
    expect(dropped).toEqual([])
    expect([...profile.d]).toEqual([1000 - 10 / GRADE, 1000, 1100, 1500, 1600, 1600 + 6 / GRADE])
    // 4 m over 400 m is 1%, gentle enough not to report.
    expect(buildTrackProfile([{ d0: 1500, d1: 1600, yReal: -6 }, { d0: 1000, d1: 1100, yReal: -10 }], OPTS).steep).toEqual([])
    for (let d = 1100; d <= 1500; d += 10) {
      expect(profileAt(profile, d)).toBeLessThanOrEqual(-6)
      expect(profileAt(profile, d)).toBeGreaterThanOrEqual(-10)
    }
  })

  it('reports an ease between close runs steeper than twice the grade', () => {
    const a = { d0: 1000, d1: 1100, yReal: -20 }
    const b = { d0: 1200, d1: 1300, yReal: -5 }
    const { steep } = buildTrackProfile([a, b], OPTS)
    expect(steep).toEqual([{ from: a, to: b, grade: expect.closeTo(0.15, 12) }])
  })

  it('gives touching runs a finite grade: a step is reported, a level join is not', () => {
    const a = { d0: 1000, d1: 1100, yReal: -10 }
    const step = buildTrackProfile([a, { d0: 1100, d1: 1200, yReal: -8 }], OPTS)
    expect(step.steep).toHaveLength(1)
    expect(step.steep[0]!.grade).toBe(2)
    expect([...step.profile.y].every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(profileAt(step.profile, 1100))).toBe(true)
    expect(buildTrackProfile([a, { d0: 1100, d1: 1200, yReal: -10 }], OPTS).steep).toEqual([])
  })

  it('climbs to the street between runs far apart', () => {
    const { profile } = buildTrackProfile(
      [
        { d0: 1000, d1: 1100, yReal: -10 },
        { d0: 3000, d1: 3100, yReal: -10 },
      ],
      OPTS,
    )
    expect(profileAt(profile, 2000)).toBe(0)
    expect(profile.d).toHaveLength(8)
  })

  it('drops and reports a run overlapping an earlier one', () => {
    const late = { d0: 1050, d1: 1200, yReal: -4 }
    const { profile, dropped } = buildTrackProfile([{ d0: 1000, d1: 1100, yReal: -10 }, late], OPTS)
    expect(dropped).toEqual([late])
    expect(buildTrackProfile([{ d0: 1000, d1: 1100, yReal: -10 }, late], OPTS).kept).toEqual([{ d0: 1000, d1: 1100, yReal: -10 }])
    const alone = buildTrackProfile([{ d0: 1000, d1: 1100, yReal: -10 }], OPTS).profile
    expect(profile).toEqual(alone)
  })

  it('starts a shape partway down a ramp that begins before d = 0', () => {
    const p = buildTrackProfile([{ d0: 0, d1: 150, yReal: -10.2 }], OPTS).profile
    expect(profileAt(p, 0)).toBeCloseTo(-10.2, 12)
    const q = buildTrackProfile([{ d0: L / 2, d1: L, yReal: -10.2 }], OPTS).profile
    expect(profileAt(q, 0)).toBeCloseTo(-5.1, 12)
    expect(profileAt(q, -L)).toBe(0)
  })
})

describe('resampleForProfile', () => {
  const points = [
    { x: 0, z: 0 },
    { x: 0, z: -900 },
    { x: 1200, z: -900 },
    { x: 1200, z: -2500 },
  ]
  const line = buildPolyline(points)

  it('returns the same points with y = 0 for an empty profile', () => {
    const r = resampleForProfile(points, line.cumulative, EMPTY_PROFILE)
    expect(r.points).toEqual(points)
    expect(r.cumulative).toEqual(line.cumulative)
    expect(r.y).toEqual([0, 0, 0, 0])
  })

  it('adds collinear vertices at the knots and through the ramps, keeping distances', () => {
    const p = one(2)
    const r = resampleForProfile(points, line.cumulative, p)
    const again = buildPolyline(r.points)
    expect(again.length).toBeCloseTo(line.length, 9)
    expect(r.cumulative).toEqual([...again.cumulative])
    for (const k of p.d) expect(r.cumulative.some((c) => Math.abs(c - k) < 1e-9)).toBe(true)
    // Far fewer vertices than a fixed 10 m step would add along the two ramps.
    expect(r.points.length).toBeLessThan(points.length + p.d.length + 20)
    expect(r.points.every((q) => q.x === 0 || q.x === 1200 || Math.abs(q.z + 900) < 1e-9)).toBe(true)
  })

  it('gives each vertex y = profileAt at its distance', () => {
    const p = one(2)
    const r = resampleForProfile(points, line.cumulative, p)
    r.y.forEach((y, i) => expect(y).toBe(profileAt(p, r.cumulative[i]!)))
    // The straight line between vertices stays within RAMP_MAX_ERROR_M of the eased profile everywhere.
    for (let i = 1; i < r.points.length; i++) {
      for (let k = 1; k < 16; k++) {
        const u = k / 16
        const d = r.cumulative[i - 1]! + (r.cumulative[i]! - r.cumulative[i - 1]!) * u
        const drawn = r.y[i - 1]! + (r.y[i]! - r.y[i - 1]!) * u
        expect(Math.abs(drawn - profileAt(p, d))).toBeLessThanOrEqual(RAMP_MAX_ERROR_M + 1e-9)
      }
    }
  })
})
