/**
 * A train that changes shape keeps its drawn point (underground-pah.16). Its last drawn point (on the old shape's
 * band, in the last frame's view) is projected onto the new shape's drawn line; the train continues from that
 * distance, and the gap left between the two drawn points (a band pitch or two where the shapes ride different
 * slots, up to CARRY_M at a junction) is kept as a world offset that eases to 0, at about CARRY_PX_PER_S on screen.
 * So the dot and cars slide onto their new band instead of jumping. Pure: the offsets live in plain arrays on the
 * slot table.
 */
import type { BandView } from '../bandOffset'
import { createTrackPoint, nearestOnTrack, trackPointInto, type DrawnTrack, type TrackHit, type TrackPoint } from './trackPoint'

/** A drawn point this close (x and z, meters) to a trip's new shape carries over to it; farther away, the dot cross-fades. */
export const CARRY_M = 25
/**
 * The offset eases out at this average speed on screen (its peak is 1.5x: 0.75 px a frame at 60 fps), within
 * CARRY_MIN_S and CARRY_MAX_S. A band pitch or two takes the minimum; a junction's 25 m at 600 m about 1.4 s.
 */
export const CARRY_PX_PER_S = 30
export const CARRY_MIN_S = 0.6
export const CARRY_MAX_S = 2

/**
 * Per-slot offsets (world meters) from the shape's drawn point to where the dot is drawn, as of `at` (NaN: none),
 * easing out over `dur` seconds.
 */
export interface CarryTable {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  at: Float64Array
  dur: Float64Array
}

export function createCarryTable(capacity: number): CarryTable {
  return {
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    z: new Float64Array(capacity),
    at: new Float64Array(capacity).fill(NaN),
    dur: new Float64Array(capacity).fill(CARRY_MIN_S),
  }
}

export function clearCarry(c: CarryTable, i: number): void {
  c.at[i] = NaN
}

/** The offset still applied at `nowS`: the recorded one times 1 - smoothstep of the time since. No allocation. */
export function carryInto(c: CarryTable, i: number, nowS: number, out: TrackPoint): TrackPoint {
  const u = (nowS - c.at[i]!) / c.dur[i]!
  // NaN (none) fails the test, so it reads as no offset.
  if (!(u < 1)) {
    out.x = out.y = out.z = 0
    return out
  }
  const v = Math.max(u, 0)
  const w = 1 - v * v * (3 - 2 * v)
  out.x = c.x[i]! * w
  out.y = c.y[i]! * w
  out.z = c.z[i]! * w
  return out
}

/** Adds slot i's offset at `nowS` to `point`, and writes the offset into `shift` (for the cars). No allocation. */
export function addCarry(c: CarryTable, i: number, nowS: number, point: TrackPoint, shift: TrackPoint): void {
  carryInto(c, i, nowS, shift)
  point.x += shift.x
  point.y += shift.y
  point.z += shift.z
}

const from = createTrackPoint()
const to = createTrackPoint()
const left = createTrackPoint()
const hit: TrackHit = { distance: 0, offsetM: 0 }

/** CSS pixels between two world points as drawn in `view`; NaN for a view not written yet. */
function screenGapPx(v: BandView, p: TrackPoint, q: TrackPoint): number {
  const e = v.view
  const wp = -(e[2]! * p.x + e[6]! * p.y + e[10]! * p.z + e[14]!)
  const wq = -(e[2]! * q.x + e[6]! * q.y + e[10]! * q.z + e[14]!)
  const dx = (e[0]! * p.x + e[4]! * p.y + e[8]! * p.z + e[12]!) / wp - (e[0]! * q.x + e[4]! * q.y + e[8]! * q.z + e[12]!) / wq
  const dy = (e[1]! * p.x + e[5]! * p.y + e[9]! * p.z + e[13]!) / wp - (e[1]! * q.x + e[5]! * q.y + e[9]! * q.z + e[13]!) / wq
  return Math.hypot(dx, dy) / v.k
}

/** Seconds a gap of `gapPx` on screen takes to ease out (CARRY_MIN_S when the view can't say). */
export function carryDurationFor(gapPx: number): number {
  return Number.isFinite(gapPx) ? Math.min(Math.max(gapPx / CARRY_PX_PER_S, CARRY_MIN_S), CARRY_MAX_S) : CARRY_MIN_S
}

/**
 * Moves slot i, drawn at `shown` along `old` (plus any offset still easing out), onto `next` in `view`: returns the
 * distance along `next` nearest the drawn point, and records the remaining gap as the slot's offset from `nowS`.
 * Returns NaN, recording nothing, when the drawn point is more than CARRY_M from `next` (the caller cross-fades).
 */
export function carryOnto(c: CarryTable, i: number, old: DrawnTrack, shown: number, next: DrawnTrack, view: BandView, nowS: number): number {
  trackPointInto(old, shown, view, from)
  addCarry(c, i, nowS, from, left)
  nearestOnTrack(next, from, view, hit)
  if (!(hit.offsetM <= CARRY_M)) return NaN
  trackPointInto(next, hit.distance, view, to)
  c.x[i] = from.x - to.x
  c.y[i] = from.y - to.y
  c.z[i] = from.z - to.z
  c.at[i] = nowS
  c.dur[i] = carryDurationFor(screenGapPx(view, from, to))
  return hit.distance
}
