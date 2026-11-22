/** Plane geometry for the entrance join, on local meters (x east, z south). Pure. */
import type { LocalPoint } from '../../src/data/stationSchema.ts'

/** Closer than this to a street's line there is no side, and a cross street may not end farther short than this. */
export const SIDE_MIN_M = 1

/** The nearest point of a polyline to an entrance, and what the entrance is relative to it. */
export interface Nearest {
  dist: number
  /** Unit direction of the way there. At a vertex between two segments, perpendicular to the entrance's offset from it. */
  tx: number
  tz: number
  /** Unit vector from the way toward the entrance; null within SIDE_MIN_M of the way's line. */
  side: readonly [number, number] | null
  /** How far past the way's true first or last vertex the entrance projects (0 when the foot is on the way). */
  pastEnd: number
}

/** Nearest point of the polyline to p. Null for a way with no length.
 *  On a segment, or past the way's first or last vertex, the side is the offset from that segment's infinite line,
 *  so it holds past a way's end. At a vertex between two segments (a bend) it is the direction from the vertex,
 *  so it does not depend on which way the way is drawn. */
export function nearestOnPolyline(p: LocalPoint, points: readonly LocalPoint[]): Nearest | null {
  let best: Nearest | null = null
  const lengths: number[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    lengths.push(Math.hypot(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1]))
  }
  // The way's true ends are its first and last segments with length; repeated end vertices do not move them.
  const first = lengths.findIndex((len) => len > 0)
  const last = lengths.findLastIndex((len) => len > 0)
  if (first === -1) return null
  for (let i = first; i <= last; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const len = lengths[i]!
    if (len === 0) continue
    const tx = (b[0] - a[0]) / len
    const tz = (b[1] - a[1]) / len
    const raw = (p[0] - a[0]) * tx + (p[1] - a[1]) * tz
    const along = Math.min(len, Math.max(0, raw))
    const rx = p[0] - (a[0] + tx * along)
    const rz = p[1] - (a[1] + tz * along)
    const dist = Math.hypot(rx, rz)
    if (best !== null && dist >= best.dist) continue
    const pastStart = i === first ? Math.max(0, -raw) : 0
    const pastEnd = i === last ? Math.max(0, raw - len) : 0
    const atBend = (raw <= 0 && i > first) || (raw >= len && i < last)
    if (atBend && dist > 0) {
      const side = dist < SIDE_MIN_M ? null : ([rx / dist, rz / dist] as const)
      best = { dist, tx: -rz / dist, tz: rx / dist, side, pastEnd: 0 }
      continue
    }
    const offset = tx * (p[1] - a[1]) - tz * (p[0] - a[0])
    const sign = Math.sign(offset)
    const side = Math.abs(offset) < SIDE_MIN_M ? null : ([-tz * sign, tx * sign] as const)
    best = { dist, tx, tz, side, pastEnd: pastStart + pastEnd }
  }
  return best
}

/** Even-odd point in polygon; the ring may repeat its first point at the end. */
export function insidePolygon(p: LocalPoint, ring: readonly LocalPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
