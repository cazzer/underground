/** Pure limits for the station orbit: a turn window that opens with the tilt, spring back to north-up, pan radius, pivot. */
import type { Ground } from './projection'

/** Pan radius around a station with no interior loaded: the station stays near the view center. */
export const PAN_RADIUS_BARE = 100
/** Slack past an interior's reach, so its farthest point can be brought to the middle with room to spare. */
export const PAN_MARGIN = 20
/**
 * Largest pan radius. With PAN_GIVE it leaves room inside EXIT_RADIUS (350) for the view center's
 * offset from the focus point (free-area shift plus depth; the test sizes it on a phone out to the
 * farthest distance the clamp applies at, PAN_CLAMP_TILT), so panning never drops focus.
 */
export const PAN_RADIUS_MAX = 180
/**
 * Tilt progress (tiltT) from which the pan clamp applies. Further out the view is nearly flat and the
 * station small on screen, so a pan is free (focus still drops at EXIT_RADIUS).
 */
export const PAN_CLAMP_TILT = 0.5
/** Tilt progress (tiltT) from which a focused view may spin a full turn. */
export const FULL_SPIN_TILT = 0.67
/** Tilt progress (tiltT) a gesture must start at to turn the view (rotateArmed). */
export const ROTATE_ARM_TILT = 0.5

/**
 * Whether a gesture may turn the view, decided once when it starts: only one begun on a focused station
 * with the view already tipped (ROTATE_ARM_TILT). A pinch that starts out unfocused or nearly top-down
 * never turns, even after focus engages part-way through it and its fingers drift sideways.
 */
export function rotateArmed(focused: boolean, tilt: number): boolean {
  return focused && tilt >= ROTATE_ARM_TILT
}

/**
 * The screen-frame offset (`right`, `toward`, written into `out`) of the view center from `point` at azimuth
 * `theta`: the inverse of rotateScreenOffset, so focusPoint(target, right, toward, theta) is `point` again.
 */
export function screenOffsetTo(target: Ground, point: Ground, theta: number, out: { right: number; toward: number }): void {
  const x = target.x - point.x
  const z = target.z - point.z
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  out.right = x * c - z * s
  out.toward = x * s + z * c
}
/** How far past the radius a drag may stretch before a hard stop. */
export const PAN_GIVE = 30
/** Exponential rate (per second) at which a stretch past the radius eases back. */
export const PAN_SPRING = 8
/** Exponential rate (per second) at which a dropped focus pulls the view back to north-up. */
export const AZIMUTH_SPRING = 3
/**
 * Fastest that spring may turn the view, radians per second (180°/s): after a big turn the exponential
 * ease alone would whip round at first; this keeps the start steady and leaves the ease for the last ~60°.
 */
export const AZIMUTH_SPRING_MAX_SPEED = Math.PI

const SNAP = 1e-4
const TWO_PI = 2 * Math.PI

/** Pan radius for a focused station: its interior's reach (farthest point from the plan center) plus a margin, or the bare radius. */
export function panRadius(reach: number | null): number {
  if (reach === null) return PAN_RADIUS_BARE
  return Math.min(reach + PAN_MARGIN, PAN_RADIUS_MAX)
}

/**
 * Pan radius around each member of a bare station complex (`points`, every member's point): PAN_RADIUS_BARE, or wide
 * enough that the members' discs overlap along their shortest joining tree by PAN_MARGIN at each join (half its longest
 * edge plus the margin), so a pan can travel from any member to any other; capped at PAN_RADIUS_MAX. The focused
 * distance being the nearest member's (focusMachine.ts), the cap keeps a full stretch inside EXIT_RADIUS as for one station.
 */
export function complexPanRadius(points: readonly Ground[]): number {
  // Prim's tree over a handful of members (five at most today); called when the focus changes, never per frame.
  const joined = points.slice(0, 1)
  const rest = points.slice(1)
  let longest = 0
  while (rest.length > 0) {
    let best = Infinity
    let at = 0
    for (let j = 0; j < rest.length; j++) {
      for (const p of joined) {
        const d = Math.hypot(rest[j]!.x - p.x, rest[j]!.z - p.z)
        if (d < best) [best, at] = [d, j]
      }
    }
    longest = Math.max(longest, best)
    joined.push(...rest.splice(at, 1))
  }
  return Math.min(Math.max(PAN_RADIUS_BARE, longest / 2 + PAN_MARGIN), PAN_RADIUS_MAX)
}

/** The point of `points` (at least one) nearest `p`. No allocation: called every frame. */
export function nearestPoint(p: Ground, points: readonly Ground[]): Ground {
  let best = points[0]!
  let bd = Infinity
  for (let i = 0; i < points.length; i++) {
    const q = points[i]!
    const d = Math.hypot(q.x - p.x, q.z - p.z)
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}

/** Exponential ease of `value` toward `goal`; snaps onto the goal once within 1e-4, so it lands exactly. */
export function springToward(value: number, goal: number, dt: number, rate: number): number {
  const next = goal + (value - goal) * Math.exp(-rate * dt)
  return Math.abs(next - goal) < SNAP ? goal : next
}

/** `theta` wrapped into (-π, π], so easing it to 0 always takes the shorter way round. */
export function wrapAngle(theta: number): number {
  const t = theta - TWO_PI * Math.floor((theta + Math.PI) / TWO_PI)
  return t === -Math.PI ? Math.PI : t
}

/**
 * Largest |azimuth| allowed at tilt progress `tilt` (tiltT): 0 top-down, so top-down is never rotated,
 * rising linearly to π at FULL_SPIN_TILT and unlimited from there. It is continuous (π just below
 * FULL_SPIN_TILT, and the controls' azimuth never leaves (-π, π]), so zooming out of a turned view
 * winds it back with the cap instead of snapping.
 */
export function azimuthCap(tilt: number): number {
  if (!(tilt > 0)) return 0
  if (tilt >= FULL_SPIN_TILT) return Infinity
  return (Math.PI * tilt) / FULL_SPIN_TILT
}

export interface AzimuthBounds {
  min: number
  max: number
}

export interface AzimuthInput {
  /** Current azimuth (OrbitControls getAzimuthalAngle), radians; 0 = camera south of the target. */
  theta: number
  focused: boolean
  /** Tilt progress at the camera's distance (tiltT). */
  tilt: number
  dt: number
  /** prefers-reduced-motion: a dropped focus snaps to north-up instead of turning back. */
  reducedMotion: boolean
}

/**
 * One frame of the return to north-up from `theta`: the short way round, an exponential ease that never
 * turns faster than AZIMUTH_SPRING_MAX_SPEED, or straight to 0 under reduced motion.
 */
export function springToNorth(theta: number, dt: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  const w = wrapAngle(theta)
  const eased = springToward(w, 0, dt, AZIMUTH_SPRING)
  const maxStep = AZIMUTH_SPRING_MAX_SPEED * dt
  return Math.abs(w - eased) > maxStep ? w - Math.sign(w) * maxStep : eased
}

/**
 * The azimuth window for this frame, written into `out` (called every frame, so no allocation).
 * Focused: ±azimuthCap, so ±Infinity (a full spin, which the controls leave unclamped) from FULL_SPIN_TILT.
 * Otherwise min = max follows springToNorth, held within the cap; the controls clamp to it, so the
 * view turns back to north-up, is north-up by the top-down distance, and a rotate gesture can't turn it.
 */
export function azimuthBounds({ theta, focused, tilt, dt, reducedMotion }: AzimuthInput, out: AzimuthBounds): AzimuthBounds {
  const cap = azimuthCap(tilt)
  if (focused) {
    out.min = -cap
    out.max = cap
  } else {
    const t = Math.max(-cap, Math.min(cap, springToNorth(theta, dt, reducedMotion)))
    out.min = t
    out.max = t
  }
  return out
}

/**
 * Whether the pan clamp applies this frame. Never while a flight or focus hold owns the camera or the
 * tilt is below PAN_CLAMP_TILT, and after one of those (or a new focus center) only once the view has
 * come inside the radius by itself: a view released, or zoomed in, outside it is left alone rather
 * than pulled in.
 */
export function panClampArmed(armed: boolean, sameCenter: boolean, busy: boolean, tilt: number, inside: boolean): boolean {
  if (busy || !(tilt >= PAN_CLAMP_TILT)) return false
  return (armed && sameCenter) || inside
}

/**
 * Writes `p` held near the circle of radius `r` around `c` into `out`, on the same bearing; true when
 * it moved. Inside the circle it is untouched. Past it, the stretch eases back at PAN_SPRING and
 * never exceeds PAN_GIVE, so a drag meets a soft edge and a short rubber band, not a wall.
 */
export function softClampToRadius(p: Ground, c: Ground, r: number, dt: number, out: Ground): boolean {
  const dx = p.x - c.x
  const dz = p.z - c.z
  const d = Math.hypot(dx, dz)
  if (d <= r) {
    out.x = p.x
    out.z = p.z
    return false
  }
  const k = (r + Math.min(springToward(d - r, 0, dt, PAN_SPRING), PAN_GIVE)) / d
  out.x = c.x + dx * k
  out.z = c.z + dz * k
  return true
}

/** Whether `p` lies in the union of the discs of radius `r` round `centers` (at least one). No allocation. */
export function insideDiscs(p: Ground, centers: readonly Ground[], r: number): boolean {
  const c = nearestPoint(p, centers)
  return Math.hypot(p.x - c.x, p.z - c.z) <= r
}

/**
 * softClampToRadius onto the union of the discs of radius `r` round `centers` (a bare complex's members; one center for
 * a lone station or an interior): `p` is held to the disc of its nearest center, the union's nearest edge for equal
 * radii. The ease moves `p` straight toward that center, which brings it nearer that center than any other by as much,
 * so the nearest center never changes mid-ease. Writes `out`; true when it moved. No allocation: called every frame.
 */
export function clampToDiscs(p: Ground, centers: readonly Ground[], r: number, dt: number, out: Ground): boolean {
  return softClampToRadius(p, nearestPoint(p, centers), r, dt, out)
}

/**
 * Ground offset for a screen-space shift when the camera sits at azimuth `theta` (camera at
 * target + (sin θ, cos θ)·horizontal): `right` along screen-right, `toward` toward the camera.
 * At θ = 0 that is +x and +z, the north-up case. Writes `out` when given.
 */
export function rotateScreenOffset(right: number, toward: number, theta: number, out: Ground = { x: 0, z: 0 }): Ground {
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  out.x = right * c + toward * s
  out.z = -right * s + toward * c
  return out
}

/**
 * The ground point the view pivots on, written into `out`: the target minus the screen offset
 * (`right`, `toward`) turned to azimuth `theta`. With freeCenterShift plus an interior's depth term
 * as the offset, its vertical axis runs through the interior's mid-depth center at the middle of
 * the free area, and every point on that axis keeps its screen spot through a turn.
 */
export function focusPoint(target: Ground, right: number, toward: number, theta: number, out: Ground): Ground {
  rotateScreenOffset(right, toward, theta, out)
  out.x = target.x - out.x
  out.z = target.z - out.z
  return out
}

/**
 * Translation (written into `out`) for the target and camera after the controls turned the camera
 * about the target from `theta0` to `theta1`: it keeps the focus point for (`right`, `toward`) where
 * it was, so the turn pivots on that point instead of on the target. Zero when the angle held.
 */
export function pivotShift(right: number, toward: number, theta0: number, theta1: number, out: Ground): Ground {
  const ds = Math.sin(theta1) - Math.sin(theta0)
  const dc = Math.cos(theta1) - Math.cos(theta0)
  out.x = right * dc + toward * ds
  out.z = -right * ds + toward * dc
  return out
}
