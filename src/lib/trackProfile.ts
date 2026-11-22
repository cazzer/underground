/**
 * A shape's vertical profile y(d): flat at each anchored platform run, eased ramps to the street (0) on either
 * side, 0 everywhere else. The map lines and the live trains both read it, so trains ride the drawn track. Pure.
 * Type-only `.ts` import because scripts/lib/trackDepth.test.ts loads this file in Node.
 */
import type { StationId, StopId } from '../data/schema.ts'
import type { Ground } from './projection.ts'
import { rampBreaks, RAMP_MAX_ERROR_M } from './rampSampling.ts'

/** Knots sorted by distance; between two knots y eases with smoothstep, outside them it holds the end value. */
export interface TrackProfile {
  readonly d: Float64Array
  readonly y: Float64Array
}

export const EMPTY_PROFILE: TrackProfile = Object.freeze({ d: new Float64Array(0), y: new Float64Array(0) })

/** Average real grade of a ramp from the street to a platform: about 340 m for Bedford Av's 10.2 m. */
export const GRADE = 0.03

/** A platform track along a shape: distances [d0, d1] (d0 <= d1) at real rail height `yReal` (negative is below). */
export interface ProfileRun {
  d0: number
  d1: number
  yReal: number
  /** The station whose platform track this is, when it comes from one (trackAnchors.ts). */
  stationId?: StationId
  /** That platform track's stop id (its deck, at a multi-deck interior). */
  stopId?: StopId
}

export interface ProfileOptions {
  /** Average real rise over run of each ramp; the ramp's horizontal length is |yReal| / grade. */
  grade: number
  /** Vertical exaggeration (the interior's): scales y, never the ramp length. */
  yScale: number
}

/** Touching runs (no gap) still get a finite grade for the report: it is measured over at least this far. */
const MIN_EASE_M = 1

export interface BuiltProfile {
  profile: TrackProfile
  /** The runs the profile is anchored to, sorted by distance (runs at the street, yReal 0, are skipped). */
  kept: ProfileRun[]
  /** Runs dropped because they overlap an earlier one (two stations claiming the same stretch of a shape). */
  dropped: ProfileRun[]
  /** Eases between two close runs steeper than twice the grade on average (real rise over run). */
  steep: { from: ProfileRun; to: ProfileRun; grade: number }[]
}

/**
 * Knots for the runs. Each run's ramps reach 0 a ramp length L = |yReal| / grade before and after it; when the
 * ramps of two neighbouring runs would overlap, the track eases straight from one run's height to the next
 * instead of climbing to the street between them. A ramp may start before d = 0 (a terminal): its knot stays
 * there, so the shape begins partway down the ramp.
 */
export function buildTrackProfile(runs: readonly ProfileRun[], opts: ProfileOptions): BuiltProfile {
  const sorted = runs.filter((r) => r.yReal !== 0).sort((a, b) => a.d0 - b.d0 || a.d1 - b.d1)
  const kept: ProfileRun[] = []
  const dropped: ProfileRun[] = []
  for (const r of sorted) {
    const last = kept.at(-1)
    if (last && r.d0 < last.d1) dropped.push(r)
    else kept.push(r)
  }
  if (kept.length === 0) return { profile: EMPTY_PROFILE, kept, dropped, steep: [] }
  const steep: BuiltProfile['steep'] = []

  const d: number[] = []
  const y: number[] = []
  const knot = (at: number, height: number) => {
    d.push(at)
    y.push(height)
  }
  const rampOf = (r: ProfileRun) => Math.abs(r.yReal) / opts.grade
  kept.forEach((r, i) => {
    const prev = kept[i - 1]
    const merged = prev !== undefined && prev.d1 + rampOf(prev) > r.d0 - rampOf(r)
    if (prev && merged) {
      const grade = Math.abs(r.yReal - prev.yReal) / Math.max(r.d0 - prev.d1, MIN_EASE_M)
      if (grade > 2 * opts.grade) steep.push({ from: prev, to: r, grade })
    }
    if (prev && !merged) knot(prev.d1 + rampOf(prev), 0)
    if (!merged) knot(r.d0 - rampOf(r), 0)
    knot(r.d0, r.yReal * opts.yScale)
    knot(r.d1, r.yReal * opts.yScale)
  })
  const last = kept.at(-1)!
  knot(last.d1 + rampOf(last), 0)
  return { profile: { d: Float64Array.from(d), y: Float64Array.from(y) }, kept, dropped, steep }
}

/** y at distance `distance` along the shape: smoothstep between the knots around it. No allocation. */
export function profileAt(p: TrackProfile, distance: number): number {
  const n = p.d.length
  if (n === 0) return 0
  if (distance <= p.d[0]!) return p.y[0]!
  if (distance >= p.d[n - 1]!) return p.y[n - 1]!
  // Largest i with d[i] <= distance; i <= n - 2 because distance < d[n - 1].
  let lo = 0
  let hi = n - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (p.d[mid]! <= distance) lo = mid
    else hi = mid - 1
  }
  const d0 = p.d[lo]!
  const span = p.d[lo + 1]! - d0
  const y0 = p.y[lo]!
  const y1 = p.y[lo + 1]!
  if (span <= 0) return y1
  const t = (distance - d0) / span
  return y0 + (y1 - y0) * t * t * (3 - 2 * t)
}

export interface ResampledLine {
  points: Ground[]
  /** Cumulative distance at each point, summed like buildPolyline / network's, so both agree on distances. */
  cumulative: number[]
  /** profileAt(profile, cumulative[i]). */
  y: number[]
}

/** Every knot, plus a point every `stepM` inside each knot span that changes height, in increasing order. */
export function profileBreaks(p: TrackProfile, stepM: number): number[] {
  const out: number[] = []
  for (let k = 0; k < p.d.length; k++) {
    const d0 = p.d[k]!
    out.push(d0)
    const d1 = p.d[k + 1]
    if (d1 === undefined || p.y[k] === p.y[k + 1]) continue
    for (let at = d0 + stepM; at < d1; at += stepM) out.push(at)
  }
  return out
}

/**
 * The line with collinear vertices added at each of `breaks` (increasing distances; ones on or outside an existing
 * vertex add nothing), and its cumulative distances re-summed. The ground path is unchanged.
 */
export function resampleAt(
  points: readonly Ground[],
  cumulative: readonly number[],
  breaks: readonly number[],
): { points: Ground[]; cumulative: number[] } {
  const out: Ground[] = []
  let b = 0
  for (let i = 0; i < points.length; i++) {
    const at = cumulative[i]!
    if (i > 0) {
      const a = points[i - 1]!
      const c = points[i]!
      const from = cumulative[i - 1]!
      const span = at - from
      while (b < breaks.length && breaks[b]! <= from) b++
      for (; b < breaks.length && breaks[b]! < at; b++) {
        const t = (breaks[b]! - from) / span
        out.push({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t })
      }
    }
    out.push(points[i]!)
  }
  const cum: number[] = []
  let sum = 0
  out.forEach((q, i) => {
    if (i > 0) sum += Math.hypot(q.x - out[i - 1]!.x, q.z - out[i - 1]!.z)
    cum.push(sum)
  })
  return { points: out, cumulative: cum }
}

/**
 * The line with collinear vertices added at the profile's knots and through its ramps (`rampBreaks`), so a
 * straight line drawn between vertices stays within `maxErrM` of the eased profile. The ground path is unchanged.
 * With an empty profile it returns the same points with y = 0.
 */
export function resampleForProfile(
  points: readonly Ground[],
  cumulative: readonly number[],
  p: TrackProfile,
  maxErrM = RAMP_MAX_ERROR_M,
): ResampledLine {
  const line = resampleAt(points, cumulative, rampBreaks(p, maxErrM))
  return { ...line, y: line.cumulative.map((d) => profileAt(p, d)) }
}
