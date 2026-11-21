/** Timing and easing for the click-to-station camera flight. Pure; CameraRig applies it. */

const MIN_DURATION_S = 1.2
const MAX_DURATION_S = 2.4
/** Extra seconds per e-fold of zoom, so a city-to-station dive takes longer than a short hop. */
const SECONDS_PER_ZOOM_E = 0.2

/** Exponential ease-in-out on [0, 1]: slow start, fast middle, slow settle. */
export function expoInOut(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2
}

/** Flight length in seconds, longer for a bigger zoom change. */
export function flightDuration(fromDistance: number, toDistance: number): number {
  const zoom = Math.abs(Math.log(Math.max(fromDistance, 1e-6) / Math.max(toDistance, 1e-6)))
  return Math.min(MAX_DURATION_S, MIN_DURATION_S + SECONDS_PER_ZOOM_E * zoom)
}

/** Eased progress for `elapsed` seconds into a flight of `duration` seconds. */
export function flightProgress(elapsed: number, duration: number): number {
  return duration > 0 ? expoInOut(elapsed / duration) : 1
}

/**
 * Camera distance at eased progress `e`, interpolated in log space: each step zooms by the same
 * factor, so a dive from the whole city doesn't spend most of the flight far out.
 */
export function flightDistance(fromDistance: number, toDistance: number, e: number): number {
  return Math.exp(Math.log(fromDistance) + (Math.log(toDistance) - Math.log(fromDistance)) * e)
}

/**
 * Share of the start-to-destination ground offset still left when the camera is at `distance`.
 * Tying the pan to the zoom keeps the destination near where it was on screen while the camera
 * closes in (screen offset ~ ground offset / distance only shrinks), then centers it at the end.
 * A flight with little zoom change pans on the eased progress `e` instead.
 */
export function remainingPan(fromDistance: number, toDistance: number, distance: number, e: number): number {
  const span = fromDistance - toDistance
  if (Math.abs(span) < 0.05 * Math.max(fromDistance, toDistance)) return 1 - e
  return Math.min(Math.max((distance - toDistance) / span, 0), 1)
}

/** Progress of a flight rebased at eased progress `e0` (a mid-flight retarget), mapped back to 0..1. */
export function rebasedProgress(e: number, e0: number): number {
  return e0 >= 1 ? 1 : Math.min(Math.max((e - e0) / (1 - e0), 0), 1)
}
