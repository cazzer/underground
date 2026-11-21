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
  nearDistance: 400,
  maxPolar: ISO_POLAR,
}

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/**
 * Tilt progress for a camera distance: 0 top-down (at and beyond farDistance), 1 fully tilted (at and inside
 * nearDistance). Linear in log-distance (zoom feels uniform) and eased at both ends.
 */
export function tiltT(distance: number, opts: TiltOptions = DEFAULT_TILT): number {
  const { farDistance, nearDistance } = opts
  if (!(distance < farDistance)) return 0
  if (distance <= nearDistance) return 1
  return smootherstep(Math.log(farDistance / distance) / Math.log(farDistance / nearDistance))
}

/** Camera distance -> polar angle (0 = top-down, maxPolar = isometric): maxPolar * tiltT. */
export function tiltForDistance(distance: number, opts: TiltOptions = DEFAULT_TILT): number {
  return opts.maxPolar * tiltT(distance, opts)
}

/**
 * How much of every drawn depth shows (0 flat, 1 full): the track profile, car height, station ties, the
 * interior's levels. It is the tilt itself, so depth only appears as the camera pitches, and full tilt keeps the
 * interiors' drawn y (yScale) as authored.
 */
export function depthFactor(distance: number, opts: TiltOptions = DEFAULT_TILT): number {
  return tiltT(distance, opts)
}

/**
 * The smallest y scale an object is drawn at, so a flat (depth 0) object never has a singular matrix. A track
 * 20 m down sits 2 cm off the street at it, which no view can show. Trains and picks use the raw depth
 * (BandView.depth), so near depth 0 they sit up to 2 cm above the floored lines: a known, invisible mismatch.
 */
export const DEPTH_FLOOR = 1e-3

/** An object's scale.y for a depth factor: the depth, floored at DEPTH_FLOOR. */
export function depthScaleY(depth: number): number {
  return Math.max(depth, DEPTH_FLOOR)
}
