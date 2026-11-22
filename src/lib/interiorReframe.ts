/**
 * The "landed, awaiting interior" rule: a station flight that set off before its interior was known, and couldn't
 * frame it in flight (it arrived after LATE_TURN_PROGRESS, or after landing), reframes onto it once it is known and
 * the flight has landed. Pure; useInteriorReframe applies it.
 */

/** A station flight that set off before its interior was known. A gesture, a new flight or a follow clears it. */
export interface AwaitingInterior {
  stationId: string
  /** Under reduced motion the reframe snaps, without a landing turn. */
  reduced: boolean
}

export interface ReframeInput {
  /** A flight is under way: its own retarget frames an interior that arrives in time, and its landing asks again. */
  flying: boolean
  /** The camera follows a train. */
  following: boolean
  focusedId: string | null
  /** The loaded interior covers the awaited station (it is its own, or the station is a member of its complex). */
  interiorReady: boolean
}

/**
 * none: nothing awaited. wait: ask again later. drop: forget it (focus moved on, or a train is followed).
 * reframe: an eased flight onto the interior that decides the landing turn then. snap: the same at once, no turn.
 */
export type ReframeAction = 'none' | 'wait' | 'drop' | 'reframe' | 'snap'

export function reframeAction(awaiting: AwaitingInterior | null, s: ReframeInput): ReframeAction {
  if (!awaiting) return 'none'
  if (s.following || s.focusedId !== awaiting.stationId) return 'drop'
  if (s.flying || !s.interiorReady) return 'wait'
  return awaiting.reduced ? 'snap' : 'reframe'
}

export const REFRAME_MIN_S = 0.6
export const REFRAME_MAX_S = 1
/** A pan (m) or a turn (rad) this big or more takes REFRAME_MAX_S. */
const FULL_PAN_M = 80
const FULL_TURN = Math.PI / 2
/** Under both of these the view already frames the interior: no reframe. */
const MIN_PAN_M = 0.5
const MIN_TURN = (0.5 * Math.PI) / 180

/**
 * Seconds for a reframe that pans `panM` meters and turns `turnRad` (either sign), growing with the bigger of the
 * two; null when there is nothing to see move.
 */
export function reframeDuration(panM: number, turnRad: number): number | null {
  const turn = Math.abs(turnRad)
  if (panM < MIN_PAN_M && turn < MIN_TURN) return null
  const share = Math.min(1, Math.max(panM / FULL_PAN_M, turn / FULL_TURN))
  return REFRAME_MIN_S + (REFRAME_MAX_S - REFRAME_MIN_S) * share
}
