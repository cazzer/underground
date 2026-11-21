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
