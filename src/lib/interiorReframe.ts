import { interiorCovers } from '../data/interiorLoad'
/**
 * The "landed, awaiting interior" rule: a station flight that set off before its interior was known, and couldn't
 * frame it in flight (it arrived after LATE_TURN_PROGRESS, or after landing), reframes onto it once it is known and
 * the flight has landed. A bare station's flight awaits its streets the same way: their entrances join the framing
 * (bareStationFrame.ts). Pure; useInteriorReframe applies it.
 */

/** A station flight that set off before its interior (or a bare station's streets) was known. A gesture, a new flight or a follow clears it. */
export interface AwaitingInterior {
  stationId: string
  /** interior: the station has (or may have) an interior. streets: it has none, and its entrances are not loaded yet. */
  kind: 'interior' | 'streets'
  /** Under reduced motion the reframe snaps, without a landing turn. */
  reduced: boolean
}

/** Whether the loaded interior (or none) covers a station awaiting its interior, a complex member included: `ReframeInput.ready`. */
export function interiorReadyFor(
  awaiting: AwaitingInterior | null,
  interior: { stationId: string; memberStationIds?: readonly string[] } | null,
): boolean {
  return awaiting?.kind === 'interior' && interiorCovers(interior, awaiting.stationId)
}

/** Whether the loaded streets are those of a station awaiting its streets: `ReframeInput.ready`. */
export function streetsReadyFor(awaiting: AwaitingInterior | null, streets: { stationId: string } | null): boolean {
  return awaiting?.kind === 'streets' && streets?.stationId === awaiting.stationId
}

export interface ReframeInput {
  /** A flight is under way: its own retarget frames an interior that arrives in time, and its landing asks again. */
  flying: boolean
  /** The camera follows a train. */
  following: boolean
  focusedId: string | null
  /** What the flight awaits has loaded: interiorReadyFor or streetsReadyFor, by its kind. */
  ready: boolean
}

/**
 * none: nothing awaited. wait: ask again later. drop: forget it (focus moved on, or a train is followed).
 * reframe: an eased flight onto the interior that decides the landing turn then (onto a bare station's entrances,
 * no turn). snap: the same at once, no turn.
 */
export type ReframeAction = 'none' | 'wait' | 'drop' | 'reframe' | 'snap'

export function reframeAction(awaiting: AwaitingInterior | null, s: ReframeInput): ReframeAction {
  if (!awaiting) return 'none'
  if (s.following || s.focusedId !== awaiting.stationId) return 'drop'
  if (s.flying || !s.ready) return 'wait'
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
