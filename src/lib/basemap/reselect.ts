/**
 * When to pick the wanted tiles again: only once the view has changed enough to matter, and then once it has
 * held still briefly or, while it keeps moving, at a steady pace. Allocation-free per frame.
 */

/** What the tile choice depends on. */
export interface ViewPose {
  /** The orbit target on the ground. */
  tx: number
  tz: number
  /** Camera to target, meters. */
  distance: number
  /** Orbit azimuth, radians. */
  azimuth: number
  /** Viewport in CSS px. */
  width: number
  height: number
}

/** A pan past this share of the camera distance matters. */
export const PAN_SHARE = 0.1
/** A zoom changing the distance by more than this share matters. */
export const ZOOM_SHARE = 0.15
/** A turn past this many radians matters (10°). */
export const TURN_RAD = (10 * Math.PI) / 180
/** A view held still this long gets its tiles. */
export const STILL_MS = 150
/** A moving view gets its tiles at most this often. */
export const MOVING_MS = 500

export function newPose(): ViewPose {
  return { tx: 0, tz: 0, distance: 0, azimuth: 0, width: 0, height: 0 }
}

export function copyPose(from: ViewPose, to: ViewPose): void {
  to.tx = from.tx
  to.tz = from.tz
  to.distance = from.distance
  to.azimuth = from.azimuth
  to.width = from.width
  to.height = from.height
}

function turn(a: number, b: number): number {
  const d = (b - a) % (2 * Math.PI)
  return Math.abs(d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d)
}

/** Whether `b` differs from `a` by more than the given pan share, zoom share and turn. */
function differs(a: ViewPose, b: ViewPose, pan: number, zoom: number, rad: number): boolean {
  return (
    a.width !== b.width ||
    a.height !== b.height ||
    Math.hypot(b.tx - a.tx, b.tz - a.tz) > pan * a.distance ||
    Math.abs(b.distance - a.distance) > zoom * a.distance ||
    turn(a.azimuth, b.azimuth) > rad
  )
}

/** The view changed enough since the last choice for the tiles to differ. */
export function meaningfulChange(selected: ViewPose, now: ViewPose): boolean {
  return differs(selected, now, PAN_SHARE, ZOOM_SHARE, TURN_RAD)
}

export interface ReselectState {
  /** The pose of the last choice; null before the first. */
  selected: ViewPose | null
  /** When the last choice was made, ms. */
  selectedAt: number
  /** Last frame's pose and when the view last moved. */
  prev: ViewPose
  movedAt: number
}

export function newReselect(): ReselectState {
  return { selected: null, selectedAt: -Infinity, prev: newPose(), movedAt: -Infinity }
}

/** Call once per frame; true when the tiles should be chosen again now (then call `markSelected`). */
export function reselectDue(state: ReselectState, pose: ViewPose, nowMs: number): boolean {
  if (differs(state.prev, pose, 1e-3, 1e-3, 1e-3)) state.movedAt = nowMs
  copyPose(pose, state.prev)
  if (state.selected === null) return true
  if (!meaningfulChange(state.selected, pose)) return false
  return nowMs - state.movedAt >= STILL_MS || nowMs - state.selectedAt >= MOVING_MS
}

export function markSelected(state: ReselectState, pose: ViewPose, nowMs: number): void {
  if (state.selected === null) state.selected = newPose()
  copyPose(pose, state.selected)
  state.selectedAt = nowMs
}
