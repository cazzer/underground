import { toGround } from '../../src/lib/projection.ts'
import type { LatLon } from '../../src/lib/projection.ts'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import type { FramePoint } from './stationInputs.ts'

const DEG = Math.PI / 180

export function roundM(n: number): number {
  const r = Math.round(n * 100) / 100
  return r === 0 ? 0 : r // no -0 in output
}

export interface Frame {
  /** [u, v] along/right of `bearingDeg` from the anchor to station-local [x east, z south]. */
  fromUV: (p: FramePoint) => LocalPoint
  /** WGS84 to station-local meters around the anchor. */
  fromLatLon: (lat: number, lon: number) => LocalPoint
}

export function makeFrame(frame: { anchor: LatLon; bearingDeg: number }): Frame {
  const sin = Math.sin(frame.bearingDeg * DEG)
  const cos = Math.cos(frame.bearingDeg * DEG)
  return {
    fromUV: ([u, v]) => [roundM(u * sin + v * cos), roundM(-u * cos + v * sin)],
    fromLatLon: (lat, lon) => {
      const g = toGround({ lat, lon }, frame.anchor)
      return [roundM(g.x), roundM(g.z)]
    },
  }
}

/** Drops a repeated closing point; a ring needs at least 3 distinct points. */
export function openRing(points: LocalPoint[], what: string): LocalPoint[] {
  const first = points[0]
  const last = points[points.length - 1]
  const closed = points.length > 1 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
  const open = closed ? points.slice(0, -1) : points
  if (open.length < 3) throw new Error(`${what}: a ring needs at least 3 points, got ${open.length}`)
  return open
}

function distanceToSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

/** 0 when `p` is inside the ring (any winding, concave ok) or on its boundary, else the
 *  shortest distance to an edge. */
export function distanceToRing(p: LocalPoint, ring: LocalPoint[]): number {
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
