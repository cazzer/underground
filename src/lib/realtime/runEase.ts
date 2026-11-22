/**
 * A run between stations the way a train drives it: a trapezoid speed profile that accelerates at a constant rate over
 * the first `RUN_RAMP_SHARE` of the run, cruises, and brakes over the last share. The area under it is the whole hop,
 * so the train still covers it in the run time and arrives exactly on time; the cruise is `RUN_PEAK_FACTOR` (1.25x)
 * the average speed.
 */
export const RUN_RAMP_SHARE = 0.2
/** Peak (cruise) speed over the average: the ramps each cover half their share at the average, so 1 / (1 - share). */
export const RUN_PEAK_FACTOR = 1 / (1 - RUN_RAMP_SHARE)

/**
 * Share of the hop covered at `u`, the share of the run time gone (both 0..1, clamped). Continuous, monotone, 0 at 0
 * and 1 at 1, with zero speed at both ends. Pure arithmetic: runs per frame.
 */
export function easeRun(u: number): number {
  if (!(u > 0)) return 0
  if (u >= 1) return 1
  if (u < RUN_RAMP_SHARE) return (RUN_PEAK_FACTOR * u * u) / (2 * RUN_RAMP_SHARE)
  if (u <= 1 - RUN_RAMP_SHARE) return RUN_PEAK_FACTOR * (u - RUN_RAMP_SHARE / 2)
  const r = 1 - u
  return 1 - (RUN_PEAK_FACTOR * r * r) / (2 * RUN_RAMP_SHARE)
}
