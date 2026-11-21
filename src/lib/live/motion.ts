import { SMOOTHING } from '../realtime/smoothing'

/**
 * How a dot absorbs a change of plan (a new poll moved where its train should be). Nothing teleports:
 * a small error eases (and a small backward one waits for a moving plan), a larger forward one glides
 * to catch up within seconds, and anything else cross-fades (shrink here, grow there).
 */

/** Forward errors up to this are closed by the per-frame ease alone. */
export const EASE_MAX_M = 150
/** A delay revision this far back (or less) waits for the plan to catch up; further back cross-fades. */
export const HOLD_BACK_M = SMOOTHING.holdBackM
/**
 * Speed a glide closes its gap at, on top of the train's own (a subway car tops out near 25 m/s). The glide
 * is sized from the gap, not the time left in the hop: a dot that trails its train should catch up in
 * seconds, not drift in over the rest of the hop (underground-d80).
 */
export const GLIDE_CATCHUP_MPS = 60
/** Shortest glide, so a gap just past the ease range doesn't dart. */
export const GLIDE_MIN_S = 3
/** Longest glide. Well under the 20 s poll, so a glide usually ends before the next plan. */
export const GLIDE_MAX_S = 10
/** A forward gap beyond this cross-fades instead (it would close at more than 120 m/s on average). */
export const GLIDE_MAX_M = 1200
/**
 * A running glide continues (keeps its end, rescaled to the new gap) while the rest of it needs no more than
 * this average closing speed: the eased glide's own peak, 1.5x its average. Faster than that, it starts over.
 */
export const GLIDE_CONTINUE_MPS = 1.5 * GLIDE_CATCHUP_MPS

/** `continue`: the running glide keeps its end and is rescaled to the new gap. */
export type Correction = { kind: 'none' } | { kind: 'glide'; durationS: number } | { kind: 'continue' } | { kind: 'crossfade' }

export interface CorrectionInput {
  /** Plan distance minus displayed distance (m); positive means the dot is behind. */
  errM: number
  /** Seconds left on a glide that is still running; null when none is. */
  glideLeftS: number | null
  /** The plan doesn't move (dwelling, or overdue at the next stop), so a delay revision can't wait for it to catch up. */
  fixedPlan: boolean
  /** The user asked for less motion: every correction cross-fades. */
  reducedMotion: boolean
}

const NONE: Correction = { kind: 'none' }
const CROSSFADE: Correction = { kind: 'crossfade' }
const CONTINUE: Correction = { kind: 'continue' }

/** Seconds a glide takes to close `errM`: at the catch-up speed, within the min and max. */
export const glideDurationFor = (errM: number): number =>
  Math.min(Math.max(errM / GLIDE_CATCHUP_MPS, GLIDE_MIN_S), GLIDE_MAX_S)

export function decideCorrection(i: CorrectionInput): Correction {
  if (i.errM < -HOLD_BACK_M || (i.fixedPlan && i.errM < -EASE_MAX_M)) return CROSSFADE
  // A running glide continues toward the new target, even a small one, unless the new gap needs it to rush.
  if (i.glideLeftS !== null && i.errM > 0 && i.errM / i.glideLeftS <= GLIDE_CONTINUE_MPS) return CONTINUE
  if (i.errM <= EASE_MAX_M) return NONE
  if (i.reducedMotion || i.errM > GLIDE_MAX_M) return CROSSFADE
  return { kind: 'glide', durationS: glideDurationFor(i.errM) }
}
