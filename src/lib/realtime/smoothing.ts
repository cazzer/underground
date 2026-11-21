export interface SmoothingParams {
  /** Time constant (s) of the exponential ease toward the target. */
  tauS: number
  /** Cap on how fast the displayed distance may advance (m/s). */
  maxSpeedMps: number
  /** Errors beyond this in either direction snap to the target (m). */
  snapM: number
  /** A target this far behind the display (or less) is held, never driven backward (m). */
  holdBackM: number
}

export const SMOOTHING: SmoothingParams = { tauS: 1.5, maxSpeedMps: 40, snapM: 1500, holdBackM: 400 }

/**
 * Eases the displayed distance along a shape toward `target` so a new poll never teleports a dot.
 * Never overshoots and never moves backward: a delayed train waits until its target catches up.
 * The caller keeps the displayed distance per trip and passes null when the trip's shape changes.
 */
export function smoothDistance(
  displayed: number | null,
  target: number,
  dtS: number,
  p: SmoothingParams = SMOOTHING,
): number {
  if (displayed === null) return target
  if (dtS <= 0) return displayed
  const e = target - displayed
  if (Math.abs(e) > p.snapM || e < -p.holdBackM) return target
  if (e <= 0) return displayed
  return displayed + Math.min(e * (1 - Math.exp(-dtS / p.tauS)), p.maxSpeedMps * dtS)
}
