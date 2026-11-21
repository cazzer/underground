/**
 * Where a train at a distance along its shape is drawn: on the map line as the band line shader draws it (each
 * vertex shifted by bandShift, straight between them), at the track's height. Every train position (dots, cars,
 * the platform copies, picks) goes through trackPointInto, so trains ride their route's band. No allocation.
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
  const y = profileAt(track.profile, track.line.cumulative[i]!)
  const s = bandShift(view, p.x, y, p.z, mx, mz, b[o + 2]!, b[o + 3]!)
  out.x += (mx / miter) * s
  out.z += (mz / miter) * s
}

const a: TrackPoint = createTrackPoint()
const c: TrackPoint = createTrackPoint()

/**
 * Writes the drawn point at `distance` (clamped to the line) into `out` and returns it: x and z on the shifted line
 * between the two vertices around it, y the profile's height there. An empty line gives the origin.
 */
export function trackPointInto(track: DrawnTrack, distance: number, view: BandView, out: TrackPoint): TrackPoint {
  const { points, cumulative, length } = track.line
  const d = Math.min(Math.max(distance, 0), length)
  out.y = profileAt(track.profile, d)
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
  return out
}
