/**
 * Where a vertical profile's ramps need drawn vertices: as few as keep the straight chords between them within a
 * height tolerance of the smoothstep ease (trackProfile.ts), placed densest where the ease curves most. Flat spans
 * get none, so a flat run stays one segment per ground vertex. Pure; `.ts` imports because a scripts/ test loads it.
 */
import type { TrackProfile } from './trackProfile.ts'

/** How far (drawn meters) the straight line may stray from the eased profile; trains read profileAt exactly. */
export const RAMP_MAX_ERROR_M = 0.25

const MAX_SEGMENTS = 64

/** smoothstep, the ease profileAt uses between knots. */
function ease(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Position (0..1) of the j-th of n chord ends, spaced equally in the integral of sqrt|ease''| (proportional to
 * sqrt|1 - 2t|), the spacing that spreads the chord error evenly: G(t) = (1 - (1 - 2t)^1.5) / 3 below 1/2,
 * 1/3 + (2t - 1)^1.5 / 3 above, total 2/3.
 */
function breakAt(j: number, n: number): number {
  const g = (2 / 3) * (j / n)
  return g <= 1 / 3 ? (1 - Math.cbrt((1 - 3 * g) ** 2)) / 2 : (1 + Math.cbrt((3 * g - 1) ** 2)) / 2
}

/** Largest |chord - ease| over a unit-height ease drawn as n chords at breakAt, sampled finely. */
function unitError(n: number): number {
  let worst = 0
  for (let j = 0; j < n; j++) {
    const t0 = breakAt(j, n)
    const t1 = breakAt(j + 1, n)
    const e0 = ease(t0)
    const e1 = ease(t1)
    for (let k = 1; k < 32; k++) {
      const u = k / 32
      worst = Math.max(worst, Math.abs(e0 + (e1 - e0) * u - ease(t0 + (t1 - t0) * u)))
    }
  }
  return worst
}

/** UNIT_ERROR[n]: the chord error of a unit-height ease in n segments; it scales linearly with the height. */
const UNIT_ERROR = Array.from({ length: MAX_SEGMENTS + 1 }, (_, n) => (n === 0 ? Infinity : unitError(n)))

/** Fewest segments that draw an ease of height `rise` within `maxErrM` (capped at MAX_SEGMENTS). */
export function easeSegments(rise: number, maxErrM: number): number {
  const h = Math.abs(rise)
  for (let n = 1; n < MAX_SEGMENTS; n++) if (UNIT_ERROR[n]! * h <= maxErrM) return n
  return MAX_SEGMENTS
}

/** Every knot, plus each height-changing span's interior chord ends, in increasing order. */
export function rampBreaks(p: TrackProfile, maxErrM = RAMP_MAX_ERROR_M): number[] {
  const out: number[] = []
  for (let k = 0; k < p.d.length; k++) {
    const d0 = p.d[k]!
    out.push(d0)
    const d1 = p.d[k + 1]
    if (d1 === undefined || p.y[k] === p.y[k + 1] || d1 <= d0) continue
    const n = easeSegments(p.y[k + 1]! - p.y[k]!, maxErrM)
    for (let j = 1; j < n; j++) out.push(d0 + (d1 - d0) * breakAt(j, n))
  }
  return out
}
