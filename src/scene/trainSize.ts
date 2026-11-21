import { markerRadiusPx } from './cameraDistance'

/** A dot is never smaller than this on screen, so it stays visible at the city overview. */
const MIN_PX = 2
/** From this camera distance in, a dot is half a station marker; from FULL_FROM out, the same size. */
const HALF_UNTIL = 6_000
const FULL_FROM = 30_000
const HALF = 0.5

/**
 * Train dot radius in screen pixels. Dots keep their Midtown-size (half a marker) when zoomed in
 * and grow to the marker's size toward the overview, where half a marker would be 1 px or less.
 */
export function trainRadiusPx(distance: number): number {
  const t = Math.min(Math.max(Math.log(distance / HALF_UNTIL) / Math.log(FULL_FROM / HALF_UNTIL), 0), 1)
  return Math.max(MIN_PX, markerRadiusPx(distance) * (HALF + (1 - HALF) * t))
}
