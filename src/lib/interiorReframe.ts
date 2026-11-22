import { interiorCovers, interiorIdOf, type IndexLoad } from '../data/interiorLoad'
/**
 * The "landed, awaiting interior" rule: a station flight that set off before its interior was known, and couldn't
 * frame it in flight (it arrived after LATE_TURN_PROGRESS, or after landing), reframes onto it once it is known and
 * the flight has landed. A bare station's flight awaits its streets the same way: their entrances join the framing
 * (freeFrame.ts). With the trip panel open an interior's flight then keeps awaiting the trip's way out there
 * (pathFrame.ts), and reframes onto it when it arrives or the panel moves, until a gesture. Pure; useInteriorReframe
 * applies it.
 */

/** A station flight that set off before its interior (or a bare station's streets) was known. A gesture, a new flight or a follow clears it. */
export interface AwaitingInterior {
  stationId: string
  /**
   * interior: the station has (or may have) an interior. streets: it has none, and its entrances are not loaded yet.
   * path: its interior is framed and the trip panel is open: the trip's path there (its way out or a change of trains)
   * is framed whenever it, or the panel, changes.
   */
  kind: 'interior' | 'streets' | 'path'
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

/** Whether a station awaiting the trip's way out has it: the loaded interior covers the station and the exit frame is that interior's. */
export function pathReadyFor(
  awaiting: AwaitingInterior | null,
  exit: { interiorId: string } | null,
  interior: { stationId: string; memberStationIds?: readonly string[] } | null,
): boolean {
  return awaiting?.kind === 'path' && exit !== null && interior !== null && exit.interiorId === interior.stationId && interiorCovers(interior, awaiting.stationId)
}

/** What an await becomes once its interior is framed: the trip's way out while the trip panel is open, else nothing. */
export function nextAwaiting(awaiting: AwaitingInterior | null, tripOpen: boolean): AwaitingInterior | null {
  if (!awaiting || awaiting.kind === 'streets' || !tripOpen) return null
  return awaiting.kind === 'path' ? awaiting : { ...awaiting, kind: 'path' }
}

/** Whether the station is known to have no interior: the index has loaded and doesn't list it. */
export function stationIsBare(stationId: string, index: IndexLoad): boolean {
  return index.status === 'ready' && interiorIdOf(stationId, index) === null
}

/**
 * The await once the index is known: a flight that set off before the index loaded (a deep link) awaits an
 * interior; once the index shows the station bare it awaits its streets instead. Otherwise unchanged.
 */
export function classifyAwaiting(awaiting: AwaitingInterior | null, index: IndexLoad): AwaitingInterior | null {
  if (awaiting?.kind !== 'interior' || !stationIsBare(awaiting.stationId, index)) return awaiting
  return { ...awaiting, kind: 'streets' }
}

/** Whether a station awaiting its streets has none to wait for: its load resolved to no file (`streets` null). */
export function streetsMissingFor(awaiting: AwaitingInterior | null, streets: { stationId: string } | null | undefined): boolean {
  return awaiting?.kind === 'streets' && streets === null
}

/** Whether the loaded streets are those of a station awaiting its streets: `ReframeInput.ready`. */
export function streetsReadyFor(awaiting: AwaitingInterior | null, streets: { stationId: string } | null | undefined): boolean {
  return awaiting?.kind === 'streets' && streets?.stationId === awaiting.stationId
}

export interface ReframeInput {
  /** A flight is under way: its own retarget frames an interior that arrives in time, and its landing asks again. */
  flying: boolean
  /** The camera follows a train. */
  following: boolean
  focusedId: string | null
  /** What the flight awaits has loaded: interiorReadyFor, streetsReadyFor or pathReadyFor, by its kind. */
  ready: boolean
  /** It never will: a bare station with no streets file (streetsMissingFor), or a way out once the trip panel closed. */
  missing: boolean
}

/**
 * none: nothing awaited. wait: ask again later. drop: forget it (focus moved on, a train is followed, or there is
 * nothing to wait for).
 * reframe: an eased flight onto the interior that decides the landing turn then (onto a bare station's entrances,
 * no turn). snap: the same at once, no turn.
 */
export type ReframeAction = 'none' | 'wait' | 'drop' | 'reframe' | 'snap'

export function reframeAction(awaiting: AwaitingInterior | null, s: ReframeInput): ReframeAction {
  if (!awaiting) return 'none'
  if (s.following || s.missing || s.focusedId !== awaiting.stationId) return 'drop'
  if (s.flying || !s.ready) return 'wait'
  return awaiting.reduced ? 'snap' : 'reframe'
}

export const REFRAME_MIN_S = 0.6
export const REFRAME_MAX_S = 1
/** A move (m) or a turn (rad) this big or more takes REFRAME_MAX_S. */
const FULL_MOVE_M = 80
const FULL_TURN = Math.PI / 2
/** Under both of these the view already frames the interior: no reframe. */
const MIN_MOVE_M = 0.5
const MIN_TURN = (0.5 * Math.PI) / 180

/**
 * Seconds for a reframe that moves `moveM` meters (the bigger of its pan and its change in camera distance) and turns
 * `turnRad` (either sign), growing with the bigger of the two; null when there is nothing to see move.
 */
export function reframeDuration(moveM: number, turnRad: number): number | null {
  const turn = Math.abs(turnRad)
  if (moveM < MIN_MOVE_M && turn < MIN_TURN) return null
  const share = Math.min(1, Math.max(moveM / FULL_MOVE_M, turn / FULL_TURN))
  return REFRAME_MIN_S + (REFRAME_MAX_S - REFRAME_MIN_S) * share
}
