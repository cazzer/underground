/** True isometric: the view direction is 54.74 degrees from vertical. */
export const ISO_POLAR = Math.atan(Math.SQRT2)

export interface TiltOptions {
  /** At or beyond this camera distance (meters) the view is straight top-down. */
  farDistance: number
  /** At or inside this camera distance the view is fully tilted. */
  nearDistance: number
  /** Polar angle (radians from vertical) when fully tilted. */
  maxPolar: number
  /**
   * Share of the log-distance span (from farDistance in) the ease-in takes, in (0, 1): the tilt rate rises from 0
   * to its peak there, then falls back to 0 at nearDistance.
   */
  easeIn: number
}

/**
 * Top-down from 1450 m, fully isometric at 400 m. The short ease-in (1450 to about 1340 m) makes the pitch visible
 * from about 1250 m (9 degrees) without moving the top-down distance far out.
 */
export const DEFAULT_TILT: TiltOptions = {
  farDistance: 1450,
  nearDistance: 400,
  maxPolar: ISO_POLAR,
  easeIn: 0.06,
}

/**
 * Two parabolas joined at `a` with matching slope: x^2 / a up to a, then 1 - (1 - x)^2 / (1 - a). The rate
 * (2x / a, then 2(1 - x) / (1 - a)) rises linearly from 0 to its peak of 2 at a and falls linearly back to 0 at 1,
 * so it is monotone and C1 everywhere, with no rate kink at either end. a = 1/2 is the symmetric smoothstep-like ease.
 */
function asymmetricEase(x: number, a: number): number {
  return x <= a ? (x * x) / a : 1 - ((1 - x) * (1 - x)) / (1 - a)
}

/**
 * Tilt progress for a camera distance: 0 top-down (at and beyond farDistance), 1 fully tilted (at and inside
 * nearDistance). Linear in log-distance (zoom feels uniform), with a short ease-in and a long ease-out.
 */
export function tiltT(distance: number, opts: TiltOptions = DEFAULT_TILT): number {
  const { farDistance, nearDistance, easeIn } = opts
  if (!(distance < farDistance)) return 0
  if (distance <= nearDistance) return 1
  return asymmetricEase(Math.log(farDistance / distance) / Math.log(farDistance / nearDistance), easeIn)
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
