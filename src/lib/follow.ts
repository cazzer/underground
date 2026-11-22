/** Pure camera math for following the selected train: where the target goes, the catch-up ease, the break rules. */
import type { Viewport } from './framing'
import { LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import type { Ground } from './projection'

/** A follow flies to the landing distance: fully tilted, cars and depth fully drawn. */
export const FOLLOW_DISTANCE = LANDING_DISTANCE
/** Exponential rate (per second) at which a catch-up offset (a panel resize, a flight cut short) eases out. */
export const FOLLOW_CATCH_RATE = 5
/** A catch-up offset under this (meters) snaps to 0, so the follow ends exact. */
export const FOLLOW_CATCH_SNAP_M = 0.01
/** A pan of this many CSS px in one gesture ends the follow (smaller drags are absorbed). */
export const FOLLOW_BREAK_PX = 8
/** A discontinuity in the train's drawn point bigger than this on screen flies there instead of easing. */
export const FOLLOW_JUMP_PX = 100

/**
 * The camera pose a follow aims for, and the screen point the train should sit on (the middle of the free area)
 * in normalized device coordinates. Filled by writeFollowView, reused every frame.
 */
export interface FollowView {
  distance: number
  polar: number
  azimuth: number
  /** tan of half the vertical field of view. */
  tanHalfFov: number
  aspect: number
  ndcX: number
  ndcY: number
}

export function createFollowView(): FollowView {
  return { distance: 0, polar: 0, azimuth: 0, tanHalfFov: 0, aspect: 1, ndcX: 0, ndcY: 0 }
}

/** Fills `out` for a camera at `distance`, `polar`, `azimuth` that should put the train mid-`free`. No allocation. */
export function writeFollowView(
  out: FollowView,
  viewport: Viewport,
  free: ScreenRect,
  fovDeg: number,
  distance: number,
  polar: number,
  azimuth: number,
): FollowView {
  out.distance = distance
  out.polar = polar
  out.azimuth = azimuth
  out.tanHalfFov = Math.tan((fovDeg * Math.PI) / 360)
  out.aspect = viewport.width / viewport.height
  out.ndcX = (free.left + free.right) / viewport.width - 1
  out.ndcY = 1 - (free.top + free.bottom) / viewport.height
  return out
}

/** Ground meters per CSS px at the target for a camera `distance` away (vertical field of view `fovDeg`). */
export function metersPerPx(distance: number, fovDeg: number, viewportHeight: number): number {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewportHeight
}

/**
 * The ground target (y = 0) that puts world point `p` exactly on the view's screen point, for a camera that looks at
 * its target from `distance` at `polar` and `azimuth` (OrbitControls' pose: camera at target + distance ·
 * (sin polar sin az, cos polar, sin polar cos az), up +y). Exact under perspective, at any height of `p`: the ray
 * through the screen point is fixed by the pose, so the camera sits on that ray back from `p`, at the height that puts
 * its target on the ground. Written into `out`; no allocation.
 */
export function followTargetInto(p: { x: number; y: number; z: number }, v: FollowView, out: Ground): Ground {
  const sp = Math.sin(v.polar)
  const cp = Math.cos(v.polar)
  const sa = Math.sin(v.azimuth)
  const ca = Math.cos(v.azimuth)
  // Camera axes: back (camera minus target, unit), right (cos az, 0, -sin az), up (-cos p sin az, sin p, -cos p cos az).
  const bx = sp * sa
  const bz = sp * ca
  const rx = v.ndcX * v.tanHalfFov * v.aspect
  const uy = v.ndcY * v.tanHalfFov
  // The ray through the screen point: forward plus its right and up parts.
  const dx = -bx + rx * ca - uy * cp * sa
  const dy = -cp + uy * sp
  const dz = -bz - rx * sa - uy * cp * ca
  // Camera height above the ground target is distance · cos polar; p sits s along the ray from it.
  const s = (p.y - v.distance * cp) / dy
  out.x = p.x - s * dx - v.distance * bx
  out.z = p.z - s * dz - v.distance * bz
  return out
}

/**
 * One frame of the catch-up offset's ease to 0, in place: exponential at FOLLOW_CATCH_RATE, snapped under
 * FOLLOW_CATCH_SNAP_M, and zeroed at once under reduced motion.
 */
export function decayCatch(c: Ground, dt: number, reducedMotion: boolean): Ground {
  const k = reducedMotion ? 0 : Math.exp(-FOLLOW_CATCH_RATE * dt)
  c.x *= k
  c.z *= k
  if (Math.hypot(c.x, c.z) < FOLLOW_CATCH_SNAP_M) c.x = c.z = 0
  return c
}

/** Whether the pan summed over a gesture (CSS px; MapControls pans one ground metersPerPx per dragged px) ends the follow. */
export function panBroke(accumPx: number): boolean {
  return accumPx >= FOLLOW_BREAK_PX
}

/** Whether a jump of `movedM` meters in the train's drawn point should fly the camera there rather than ease. */
export function anchorJumped(movedM: number, mpp: number): boolean {
  return movedM / mpp > FOLLOW_JUMP_PX
}
