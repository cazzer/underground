/** True isometric: the view direction is 54.74 degrees from vertical. */
export const ISO_POLAR = Math.atan(Math.SQRT2)

export interface TiltOptions {
  /** At or beyond this camera distance (meters) the view is straight top-down. */
  farDistance: number
  /** At or inside this camera distance the view is fully tilted. */
  nearDistance: number
  /** Polar angle (radians from vertical) when fully tilted. */
  maxPolar: number
}

export const DEFAULT_TILT: TiltOptions = {
  farDistance: 1400,
  nearDistance: 180,
  maxPolar: ISO_POLAR,
}

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/**
 * Camera distance -> polar angle (0 = top-down, maxPolar = isometric).
 * Progress is linear in log-distance (zoom feels uniform) and eased at both ends.
 */
export function tiltForDistance(distance: number, opts: TiltOptions = DEFAULT_TILT): number {
  const { farDistance, nearDistance, maxPolar } = opts
  if (distance >= farDistance) return 0
  if (distance <= nearDistance) return maxPolar
  const t = Math.log(farDistance / distance) / Math.log(farDistance / nearDistance)
  return maxPolar * smootherstep(t)
}
