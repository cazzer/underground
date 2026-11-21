/** Pure limits for the station orbit: azimuth window, spring back to north-up, pan radius. */
import { EXIT_DISTANCE } from './focusMachine'
import type { Ground } from './projection'
import { DEFAULT_TILT } from './tilt'

/** Pan radius around the focused station. Between ENTER_RADIUS (140) and EXIT_RADIUS (300): panning never drops focus. */
export const ORBIT_RADIUS = 200
/** Exponential rate (per second) at which a dropped focus pulls the view back to north-up. */
export const AZIMUTH_SPRING = 4

const SNAP = 1e-4

/** Exponential ease of `value` toward `goal`; snaps onto the goal once within 1e-4, so it lands exactly. */
export function springToward(value: number, goal: number, dt: number, rate: number): number {
  const next = goal + (value - goal) * Math.exp(-rate * dt)
  return Math.abs(next - goal) < SNAP ? goal : next
}

/**
 * Half-width of the azimuth window at camera `distance`: the full `limit` up to EXIT_DISTANCE (where
 * focus drops), falling linearly to 0 at the tilt's top-down distance, so top-down is never rotated.
 */
export function azimuthLimit(distance: number, limit: number): number {
  const far = DEFAULT_TILT.farDistance
  if (distance >= far) return 0
  if (distance <= EXIT_DISTANCE) return limit
  return (limit * (far - distance)) / (far - EXIT_DISTANCE)
}

export interface AzimuthBounds {
  min: number
  max: number
  rotate: boolean
}

export interface AzimuthInput {
  /** Current azimuth (OrbitControls getAzimuthalAngle), radians; 0 = camera south of the target. */
  theta: number
  focused: boolean
  /** Camera distance to its target. */
  distance: number
  /** Half-width of the window at full tilt, radians. */
  limit: number
  dt: number
}

/**
 * Controls settings for this frame, written into `out` (called every frame, so no allocation).
 * Focused: rotation on, window ±azimuthLimit. Otherwise rotation is off and min = max springs from
 * the current azimuth to 0, which the controls clamp to, so the view eases back to north-up.
 */
export function azimuthBounds({ theta, focused, distance, limit, dt }: AzimuthInput, out: AzimuthBounds): AzimuthBounds {
  if (focused) {
    const l = azimuthLimit(distance, limit)
    out.min = -l
    out.max = l
    out.rotate = true
  } else {
    const t = springToward(theta, 0, dt, AZIMUTH_SPRING)
    out.min = t
    out.max = t
    out.rotate = false
  }
  return out
}

/** Writes `p` limited to within `r` of `c` into `out` (same bearing from `c`); true when it had to move. */
export function clampToRadius(p: Ground, c: Ground, r: number, out: Ground): boolean {
  const dx = p.x - c.x
  const dz = p.z - c.z
  const d = Math.hypot(dx, dz)
  if (d <= r) {
    out.x = p.x
    out.z = p.z
    return false
  }
  const k = r / d
  out.x = c.x + dx * k
  out.z = c.z + dz * k
  return true
}

/**
 * Ground offset for a screen-space shift when the camera sits at azimuth `theta` (camera at
 * target + (sin θ, cos θ)·horizontal): `right` along screen-right, `toward` toward the camera.
 * At θ = 0 that is +x and +z, the north-up case.
 */
export function rotateScreenOffset(right: number, toward: number, theta: number): Ground {
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  return { x: right * c + toward * s, z: -right * s + toward * c }
}
