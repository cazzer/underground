import { SMOOTHING } from '../realtime/smoothing'

/**
 * How a dot absorbs a change of plan (a new poll moved where its train should be). Nothing teleports:
 * a small error eases (and a small backward one waits), a larger forward one glides so the train reaches
 * its next stop on time, and anything else cross-fades (shrink here, grow there).
 */

/** Forward errors up to this are closed by the per-frame ease alone. */
export const EASE_MAX_M = 150
/** A delay revision this far back (or less) waits for the plan to catch up; further back cross-fades. */
export const HOLD_BACK_M = SMOOTHING.holdBackM
/** A glide may not imply a faster train than this (a subway car tops out near 25 m/s). */
export const GLIDE_MAX_MPS = 30
/** Closing speed of a glide toward a plan that isn't moving (dwelling, or overdue at the next stop). */
export const GLIDE_CATCHUP_MPS = 15
/** Longest glide; a bigger gap cross-fades instead. */
export const GLIDE_MAX_S = 90
/** A plan this close to its arrival has no time left to glide in. */
const MIN_GLIDE_S = 1

export type Correction = { kind: 'none' } | { kind: 'glide'; durationS: number } | { kind: 'crossfade' }

export interface CorrectionInput {
  /** Plan distance minus displayed distance (m); positive means the dot is behind. */
  errM: number
  /** From the displayed position to the end of the planned hop (m). */
  remainingM: number
  /** Seconds until the planned arrival; null when the plan is fixed or already overdue. */
  timeToArriveS: number | null
  /** The trip moved to another shape. */
  reshaped: boolean
  /** The user asked for less motion: every correction cross-fades. */
  reducedMotion: boolean
}

const NONE: Correction = { kind: 'none' }
const CROSSFADE: Correction = { kind: 'crossfade' }

export function decideCorrection(i: CorrectionInput): Correction {
  if (i.reshaped || i.errM < -HOLD_BACK_M) return CROSSFADE
  if (i.errM <= EASE_MAX_M) return NONE
  if (i.reducedMotion) return CROSSFADE
  if (i.timeToArriveS !== null && i.timeToArriveS >= MIN_GLIDE_S) {
    return i.remainingM / i.timeToArriveS <= GLIDE_MAX_MPS ? { kind: 'glide', durationS: i.timeToArriveS } : CROSSFADE
  }
  const durationS = i.errM / GLIDE_CATCHUP_MPS
  return durationS <= GLIDE_MAX_S ? { kind: 'glide', durationS } : CROSSFADE
}
