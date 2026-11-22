/**
 * Where a train at a distance along its shape is drawn: on the map line as the band line shader draws it (each
 * vertex shifted by bandShift, straight between them), at the track's drawn height (profile y times the view's
 * depth factor, as the lines' scale.y draws it). Every train position (dots, cars, the platform copies, picks) goes
 * through trackPointInto, so trains ride their route's band at the lines' height. No allocation.
 */
import { bandShift, type BandView } from '../bandOffset'
import { BAND_INPUTS } from '../lineBuffers'
import type { Polyline } from '../realtime/polyline'
import { profileAt, type TrackProfile } from '../trackProfile'

/** A drawn track: the map line's vertices and distances, its profile and each vertex's band inputs (lineBuffers.ts). */
export interface DrawnTrack {
  line: Polyline
  profile: TrackProfile
  bandInputs: Float32Array
}

export interface TrackPoint {
  x: number
  y: number
  z: number
}

export function createTrackPoint(): TrackPoint {
  return { x: 0, y: 0, z: 0 }
}

/** Largest segment index s <= n - 2 with cumulative[s] <= d. */
function segmentAt(cumulative: readonly number[], d: number): number {
  let lo = 0
  let hi = Math.max(0, cumulative.length - 2)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cumulative[mid]! <= d) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Vertex i of `track` shifted by its band offset in `view`, x into out.x and z into out.z (y untouched). */
function shiftedVertex(track: DrawnTrack, i: number, view: BandView, out: TrackPoint): void {
  const p = track.line.points[i]!
  const o = i * BAND_INPUTS
  const b = track.bandInputs
  const mx = b[o]!
  const mz = b[o + 1]!
  const miter = Math.hypot(mx, mz)
  out.x = p.x
  out.z = p.z
  // No normal (a degenerate line, or no inputs written): drawn unshifted, as the shader draws it.
  if (!(miter > 0)) return
  const y = profileAt(track.profile, track.line.cumulative[i]!) * view.depth
  const s = bandShift(view, p.x, y, p.z, mx, mz, b[o + 2]!, b[o + 3]!)
  out.x += (mx / miter) * s
  out.z += (mz / miter) * s
}

const a: TrackPoint = createTrackPoint()
const c: TrackPoint = createTrackPoint()

/**
 * Writes the drawn point at `distance` (clamped to the line) into `out` and returns it: x, z and y all on the drawn
 * line between the two vertices around it (y interpolated between the vertices' profile heights, as the GPU draws the
 * chord), so a train sits exactly on its line however coarsely the ramps are sampled. An empty line gives the origin.
 */
export function trackPointInto(track: DrawnTrack, distance: number, view: BandView, out: TrackPoint): TrackPoint {
  const { points, cumulative, length } = track.line
  const d = Math.min(Math.max(distance, 0), length)
  out.y = profileAt(track.profile, d) * view.depth
  if (points.length === 0) {
    out.x = out.z = 0
    return out
  }
  if (points.length === 1) {
    shiftedVertex(track, 0, view, out)
    return out
  }
  const s = segmentAt(cumulative, d)
  const span = cumulative[s + 1]! - cumulative[s]!
  const t = span > 0 ? (d - cumulative[s]!) / span : 0
  shiftedVertex(track, s, view, a)
  shiftedVertex(track, s + 1, view, c)
  out.x = a.x + (c.x - a.x) * t
  out.z = a.z + (c.z - a.z) * t
  const y0 = profileAt(track.profile, cumulative[s]!)
  out.y = (y0 + (profileAt(track.profile, cumulative[s + 1]!) - y0) * t) * view.depth
  return out
}

/** The nearest point of a drawn track: its distance along the line and how far (xz meters) it is from the query. */
export interface TrackHit {
  distance: number
  offsetM: number
}

/**
 * The drawn point of `track` (as trackPointInto draws it in `view`) nearest `p` in x and z, into `out`: every segment
 * between two shifted vertices is tested, and the distance on it maps back linearly, as trackPointInto interpolates.
 * Scans the whole line (called per poll, for a train that changed shape). No allocation.
 */
export function nearestOnTrack(track: DrawnTrack, p: TrackPoint, view: BandView, out: TrackHit): TrackHit {
  const { points, cumulative } = track.line
  out.distance = 0
  out.offsetM = Infinity
  if (points.length === 0) return out
  shiftedVertex(track, 0, view, a)
  if (points.length === 1) {
    out.offsetM = Math.hypot(p.x - a.x, p.z - a.z)
    return out
  }
  for (let s = 0; s < points.length - 1; s++) {
    shiftedVertex(track, s + 1, view, c)
    const dx = c.x - a.x
    const dz = c.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 > 0 ? Math.min(Math.max(((p.x - a.x) * dx + (p.z - a.z) * dz) / len2, 0), 1) : 0
    const offsetM = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
    if (offsetM < out.offsetM) {
      out.offsetM = offsetM
      out.distance = cumulative[s]! + t * (cumulative[s + 1]! - cumulative[s]!)
    }
    a.x = c.x
    a.z = c.z
  }
  return out
}
