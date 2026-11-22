/** Which street label candidates sit on a street that carries a subway line, and where that bundle lies. Pure; runs
 *  once per station load. */
import type { Ground } from './projection'
import type { StreetLabelSource } from './streetRuns'

/** A route's drawn track counts as along a street candidate within this far of it, meters. */
export const ROUTE_NEAR_M = 12
/** ...and running within this angle of the street's direction (|cos| at least this). */
const ALONG_MIN_COS = Math.cos((35 * Math.PI) / 180)

/** What the bundle count needs from a drawn shape: its route and its scene ground points. */
export interface RouteTrack {
  routeId: string
  points: readonly Ground[]
}

interface Segment {
  routeId: string
  ax: number
  az: number
  bx: number
  bz: number
  tx: number
  tz: number
}

/** The nearest point of segment s to (x, z), written into `q`; returns the distance. */
function nearestOnSegment(s: Segment, x: number, z: number, q: { x: number; z: number }): number {
  const dx = s.bx - s.ax
  const dz = s.bz - s.az
  const len2 = dx * dx + dz * dz
  const t = len2 > 0 ? Math.min(Math.max(((x - s.ax) * dx + (z - s.az) * dz) / len2, 0), 1) : 0
  q.x = s.ax + dx * t
  q.z = s.az + dz * t
  return Math.hypot(x - q.x, z - q.z)
}

/** Floats per candidate in a run's bundle array: route count, then the nearest-lateral extent of their tracks
 *  either side of the street (meters along (-tz, tx), the street's left: lo ≤ 0 ≤ hi when they straddle it). */
export const BUNDLE_STRIDE = 3

/**
 * Per street, per run: for each candidate (streetRuns.ts, meters from `anchor`) BUNDLE_STRIDE floats: how many
 * distinct routes' drawn tracks run along the street there (within ROUTE_NEAR_M, near-parallel), and the lateral
 * extent of those tracks off the street's centerline (lo, hi; 0, 0 with none). A label clears the bundle by sitting
 * beyond that extent. Only tracks within `reachM` of the anchor are looked at.
 */
export function routeBundles(streets: readonly StreetLabelSource[], anchor: Ground, tracks: readonly RouteTrack[], reachM: number): Float32Array[][] {
  const near = reachM + ROUTE_NEAR_M
  const q = { x: 0, z: 0 }
  const segments: Segment[] = []
  for (const t of tracks) {
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1]!
      const b = t.points[i]!
      const s = { routeId: t.routeId, ax: a.x - anchor.x, az: a.z - anchor.z, bx: b.x - anchor.x, bz: b.z - anchor.z, tx: 0, tz: 0 }
      if (nearestOnSegment(s, 0, 0, q) > near) continue
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
      if (!(len > 0)) continue
      s.tx = (s.bx - s.ax) / len
      s.tz = (s.bz - s.az) / len
      segments.push(s)
    }
  }
  return streets.map((street) =>
    street.runs.map((run) => {
      const out = new Float32Array(run.length * BUNDLE_STRIDE)
      run.forEach((c, k) => {
        const routes = new Set<string>()
        let lo = 0
        let hi = 0
        for (const s of segments) {
          if (Math.abs(s.tx * c.tx + s.tz * c.tz) < ALONG_MIN_COS) continue
          if (nearestOnSegment(s, c.x, c.z, q) > ROUTE_NEAR_M) continue
          routes.add(s.routeId)
          const lateral = (q.x - c.x) * -c.tz + (q.z - c.z) * c.tx
          lo = Math.min(lo, lateral)
          hi = Math.max(hi, lateral)
        }
        out[k * BUNDLE_STRIDE] = routes.size
        out[k * BUNDLE_STRIDE + 1] = lo
        out[k * BUNDLE_STRIDE + 2] = hi
      })
      return out
    }),
  )
}
