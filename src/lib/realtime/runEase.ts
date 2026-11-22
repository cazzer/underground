/**
 * A run between stations the way a train drives it: a trapezoid speed profile that accelerates at a constant rate over
 * the first share of the run, cruises, and brakes over the same share at the end. The area under it is the whole hop,
 * so the train still covers it in the run time and arrives exactly on time; with ramp share `a` the cruise is
 * 1 / (1 - a) the average speed (each ramp covers half its share at the average).
 */
export const RUN_RAMP_SHARE = 0.2
/** Cruise speed over the average with the full ramps: 1.25x. */
export const RUN_PEAK_FACTOR = 1 / (1 - RUN_RAMP_SHARE)
/** About a subway car's top speed (55 mph): no run cruises faster, so a fast hop gets shorter ramps instead. */
export const MAX_CRUISE_MPS = 25

/**
 * The ramp share for a hop of `distanceM` covered in `moveS` seconds of running: RUN_RAMP_SHARE, or less when the
 * full ramps would cruise above MAX_CRUISE_MPS (0, constant speed, when even the average is above it). Once per poll.
 */
export function rampShareFor(distanceM: number, moveS: number): number {
  const peak = Math.min(RUN_PEAK_FACTOR, Math.max(1, (MAX_CRUISE_MPS * moveS) / distanceM))
  return Math.max(0, 1 - 1 / peak)
}

/**
 * Share of the hop covered at `u`, the share of the run time gone (both 0..1, clamped), with ramp share `a` (0 to 0.5;
 * 0 is constant speed). Continuous, monotone, 0 at 0 and 1 at 1, at rest at both ends when `a` > 0. Pure arithmetic:
 * runs per frame.
 */
export function easeRun(u: number, a: number = RUN_RAMP_SHARE): number {
  if (!(u > 0)) return 0
  if (u >= 1) return 1
  if (!(a > 0)) return u
  const peak = 1 / (1 - a)
  if (u < a) return (peak * u * u) / (2 * a)
  if (u <= 1 - a) return peak * (u - a / 2)
  const r = 1 - u
  return 1 - (peak * r * r) / (2 * a)
}
