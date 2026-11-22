export type CollapsiblePanel = 'station' | 'trip'

/** The panel in the HUD's bottom slot that is in front. */
export type FrontPanel = CollapsiblePanel | 'train' | 'notice' | null

export interface CollapseState {
  readonly station: boolean
  readonly trip: boolean
  /** Counts user collapses and expands only. */
  readonly seq: number
}

export const INITIAL_COLLAPSE: CollapseState = { station: false, trip: false, seq: 0 }

export type CollapseAction =
  | { type: 'set'; panel: CollapsiblePanel; collapsed: boolean; front: FrontPanel }
  | { type: 'tripClosed' }
  /** An explicit station pick (search, tap, "Go to", a link): the station panel opens expanded. Not a toggle, so no `seq`. */
  | { type: 'picked' }

/**
 * Which panel is in front, in the order Hud.tsx renders them: a train panel, then a gone notice, then the trip panel
 * (while open), then the station panel (while a station is focused). Keep it in step with Hud's bottom slot.
 */
export function frontPanel(input: { trainShown: boolean; noticeShown: boolean; tripOpen: boolean; focusedId: string | null }): FrontPanel {
  if (input.trainShown) return 'train'
  if (input.noticeShown) return 'notice'
  if (input.tripOpen) return 'trip'
  if (input.focusedId !== null) return 'station'
  return null
}

/**
 * A user toggle counts only on the panel in front and only when it changes the flag (so `seq` never moves for a
 * no-op); a closed trip panel resets its flag silently, since opening Trip is a request to plan.
 */
export function collapseReducer(state: CollapseState, action: CollapseAction): CollapseState {
  if (action.type === 'tripClosed') return state.trip ? { ...state, trip: false } : state
  if (action.type === 'picked') return state.station ? { ...state, station: false } : state
  if (action.front !== action.panel || state[action.panel] === action.collapsed) return state
  return { ...state, [action.panel]: action.collapsed, seq: state.seq + 1 }
}

/** True only while the front panel is a collapsed station or trip panel. */
export function collapsedFront(state: CollapseState, front: FrontPanel): boolean {
  if (front === 'station') return state.station
  if (front === 'trip') return state.trip
  return false
}
