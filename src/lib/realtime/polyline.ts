import type { Ground } from '../projection'

export interface Polyline {
  points: readonly Ground[]
  /** Distance along the line to each point; cumulative[0] = 0. */
  cumulative: readonly number[]
  length: number
}

export function buildPolyline(points: readonly Ground[]): Polyline {
  const cumulative: number[] = []
  let sum = 0
  points.forEach((p, i) => {
    if (i > 0) sum += Math.hypot(p.x - points[i - 1]!.x, p.z - points[i - 1]!.z)
    cumulative.push(sum)
  })
  return { points, cumulative, length: sum }
}

/** Largest segment index s <= m-2 with cumulative[s] <= d (0 for a line with fewer than two points). */
function segmentAt(line: Polyline, d: number): number {
  let lo = 0
  let hi = Math.max(0, line.points.length - 2)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (line.cumulative[mid]! <= d) lo = mid
    else hi = mid - 1
  }
  return lo
}

function segmentHeading(line: Polyline, s: number): number | null {
  const a = line.points[s]
  const b = line.points[s + 1]
  if (!a || !b) return null
  const dx = b.x - a.x
  const dz = b.z - a.z
  return dx === 0 && dz === 0 ? null : Math.atan2(dx, -dz)
}

/**
 * Ground point at `distance` along the line (clamped to [0, length]) and the heading of the segment there,
 * in radians clockwise from north (-z): 0 is north, PI/2 east. Unit vector: { x: sin h, z: -cos h }.
 */
export function pointAtDistance(line: Polyline, distance: number): { point: Ground; heading: number } {
  const first = line.points[0]
  if (!first) throw new Error('pointAtDistance: empty polyline')
  const d = Math.min(Math.max(distance, 0), line.length)
  const s = segmentAt(line, d)

  let heading: number | null = null
  for (let i = s; heading === null && i < line.points.length - 1; i++) heading = segmentHeading(line, i)
  for (let i = s - 1; heading === null && i >= 0; i--) heading = segmentHeading(line, i)

  const a = line.points[s]!
  const b = line.points[s + 1]
  if (!b) return { point: { x: a.x, z: a.z }, heading: heading ?? 0 }
  const segLen = line.cumulative[s + 1]! - line.cumulative[s]!
  const t = segLen > 0 ? (d - line.cumulative[s]!) / segLen : 0
  return { point: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, heading: heading ?? 0 }
}

/** Stop scanning once the line is this far past a candidate that is already close to the point. */
const SCAN_PAST_BEST_M = 500
const CLOSE_ENOUGH_M = 150

/**
 * Closest point on the line at or after `from` (segment index and parameter), so successive calls
 * never move backward. Ties go to the earliest segment. offsetM is the perpendicular distance.
 * The scan ends early once the line has run SCAN_PAST_BEST_M past a candidate within CLOSE_ENOUGH_M;
 * a candidate that is still far away keeps the scan going (hairpins, loops).
 */
export function projectForward(
  line: Polyline,
  p: Ground,
  from: { segment: number; t: number },
): { distance: number; offsetM: number; segment: number; t: number } {
  const pts = line.points
  if (pts.length === 0) throw new Error('projectForward: empty polyline')
  if (pts.length === 1) return { distance: 0, offsetM: Math.hypot(p.x - pts[0]!.x, p.z - pts[0]!.z), segment: 0, t: 0 }

  const cum = line.cumulative
  const distanceOf = (segment: number, t: number): number => cum[segment]! + t * (cum[segment + 1]! - cum[segment]!)
  let best = { offsetM: Infinity, segment: from.segment, t: from.t }
  let bestDistance = Infinity
  for (let s = from.segment; s < pts.length - 1; s++) {
    if (best.offsetM <= CLOSE_ENOUGH_M && cum[s]! > bestDistance + SCAN_PAST_BEST_M) break
    const a = pts[s]!
    const b = pts[s + 1]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0
    t = Math.min(Math.max(t, s === from.segment ? from.t : 0), 1)
    const offsetM = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
    if (offsetM < best.offsetM) {
      best = { offsetM, segment: s, t }
      bestDistance = distanceOf(s, t)
    }
  }
  return { ...best, distance: bestDistance }
}
