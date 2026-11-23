export type CollapsiblePanel = 'station' | 'trip' | 'changes'

/** The panel in the HUD's bottom slot that is in front. */
export type FrontPanel = CollapsiblePanel | 'train' | 'notice' | null

export interface CollapseState {
  readonly station: boolean
  readonly trip: boolean
  /** The service-changes list's collapse; it resets when the list closes. */
  readonly changes: boolean
  /** The header's service-changes list is open (a toggle of the header chip, nothing else opens it). */
  readonly changesOpen: boolean
  /** Counts user collapses and expands only. */
  readonly seq: number
}

export const INITIAL_COLLAPSE: CollapseState = { station: false, trip: false, changes: false, changesOpen: false, seq: 0 }

export type CollapseAction =
  | { type: 'set'; panel: CollapsiblePanel; collapsed: boolean; front: FrontPanel }
  | { type: 'tripClosed' }
  /** A directions pick: the trip panel opens or stays expanded. Not a toggle, so no `seq`. */
  | { type: 'tripRequested' }
  /** The header chip opens the list, expanded. Not a toggle, so no `seq`. */
  | { type: 'changesOpened' }
  /** The list closes (its Close, Esc, the chip, a directions pick) and forgets its collapse. No `seq`. */
  | { type: 'changesClosed' }
  /** An explicit station pick (search, tap, "Go to", a link): the station panel opens expanded. Not a toggle, so no `seq`. */
  | { type: 'picked' }

/**
 * Which panel is in front, in the order Hud.tsx renders them: a train panel, then a gone notice, then the service
 * changes list (while open: the header chip is a deliberate request for it, so it covers the trip and station panels,
 * and a train pick still covers it), then the trip panel (while open), then the station panel (while a station is
 * focused). Hud's bottom slot branches on it, so this is the one rule.
 */
export function frontPanel(input: {
  trainShown: boolean
  noticeShown: boolean
  changesOpen: boolean
  tripOpen: boolean
  focusedId: string | null
}): FrontPanel {
  if (input.trainShown) return 'train'
  if (input.noticeShown) return 'notice'
  if (input.changesOpen) return 'changes'
  if (input.tripOpen) return 'trip'
  if (input.focusedId !== null) return 'station'
  return null
}

/**
 * A user toggle counts only on the panel in front and only when it changes the flag (so `seq` never moves for a
 * no-op); a closed trip panel resets its flag silently, since a directions pick is a request to plan.
 */
export function collapseReducer(state: CollapseState, action: CollapseAction): CollapseState {
  if (action.type === 'tripClosed' || action.type === 'tripRequested') return state.trip ? { ...state, trip: false } : state
  if (action.type === 'picked') return state.station ? { ...state, station: false } : state
  if (action.type === 'changesOpened') return state.changesOpen && !state.changes ? state : { ...state, changesOpen: true, changes: false }
  if (action.type === 'changesClosed') return !state.changesOpen && !state.changes ? state : { ...state, changesOpen: false, changes: false }
  if (action.front !== action.panel || state[action.panel] === action.collapsed) return state
  return { ...state, [action.panel]: action.collapsed, seq: state.seq + 1 }
}

/** True only while the front panel is a collapsed station, trip or service changes panel. */
export function collapsedFront(state: CollapseState, front: FrontPanel): boolean {
  if (front === 'station') return state.station
  if (front === 'trip') return state.trip
  if (front === 'changes') return state.changes
  return false
}
