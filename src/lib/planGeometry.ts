/** Plan-view geometry on [x, z] meter points, shared by the walk router and the interior graph. */
import type { LocalPoint } from '../data/stationSchema'

/** Parameter 0..1 of the point on segment a-b nearest p; 0 for a zero-length segment. */
export function segmentT(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return 0
  return Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
}

function distanceToSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const t = segmentT(p, a, b)
  return Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])))
}

/**
 * 0 when `p` is inside the ring (any winding, concave ok) or on its boundary, else the shortest distance to an edge.
 * A copy of scripts/lib/stationGeometry.ts `distanceToRing` (src must not import scripts).
 */
export function distanceToRing(p: LocalPoint, ring: readonly LocalPoint[]): number {
  let inside = false
  let nearest = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    nearest = Math.min(nearest, distanceToSegment(p, a, b))
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside ? 0 : nearest
}

export interface PolylineHit {
  point: LocalPoint
  /** Meters along the polyline from its first point to `point`. */
  along: number
  /** Meters from the query point to `point`. */
  distance: number
  /** The polyline's whole length. */
  total: number
}

/** The nearest point of an open polyline (at least one point) to `p`. */
export function nearestOnPolyline(points: readonly LocalPoint[], p: LocalPoint): PolylineHit {
  let best: PolylineHit = { point: points[0]!, along: 0, distance: Math.hypot(p[0] - points[0]![0], p[1] - points[0]![1]), total: 0 }
  let run = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const t = segmentT(p, a, b)
    const point: LocalPoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    const distance = Math.hypot(p[0] - point[0], p[1] - point[1])
    if (distance < best.distance) best = { point, along: run + t * len, distance, total: 0 }
    run += len
  }
  return { ...best, total: run }
}

/** The point at `m` meters along the polyline (clamped), with the index of the segment it lies on. */
function pointAt(points: readonly LocalPoint[], m: number): { point: LocalPoint; segment: number } {
  let run = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (m <= run + len || i + 2 === points.length) {
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, (m - run) / len))
      return { point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], segment: i }
    }
    run += len
  }
  return { point: points[0]!, segment: 0 }
}

/**
 * The part of a polyline from `fromM` to `toM` meters along it, in that order (forward or backward): the two cut
 * points plus the vertices between them, without repeats. Both distances are clamped to the line.
 */
export function slicePolyline(points: readonly LocalPoint[], fromM: number, toM: number): LocalPoint[] {
  const start = pointAt(points, fromM)
  const end = pointAt(points, toM)
  if (fromM === toM) return [start.point]
  const out: LocalPoint[] = [start.point]
  if (fromM < toM) {
    for (let i = start.segment + 1; i <= end.segment; i++) out.push(points[i]!)
  } else {
    for (let i = start.segment; i > end.segment; i--) out.push(points[i]!)
  }
  out.push(end.point)
  return out.filter((q, i) => i === 0 || q[0] !== out[i - 1]![0] || q[1] !== out[i - 1]![1])
}
