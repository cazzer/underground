/**
 * The resize reframe (ost.18): a bare station's phone panel that changes height just after its landing (the outage
 * disclosure once the equipment index or /ene joins, the first arrivals or their "Show all N destinations" button, a
 * status line) leaves fewer entrance marks above it. A move inside RESIZE_WINDOW_MS of the station's own landing may
 * reframe it once onto its marks (moveGains in collapseReframe.ts: only for strictly more). After the window, after the
 * one reframe, or once the user has pressed a pointer or a key, no panel change but a user collapse or expand moves the
 * camera.
 * Pure; useCollapseReframe applies it.
 */

/** How long after a bare station's landing a panel move may still reframe it. */
export const RESIZE_WINDOW_MS = 2000

/** Open after a bare station's own landing until it expires, the station reframes once, or the user presses anything. */
export interface ResizeWindow {
  stationId: string
  /** performance.now() when it closes, ms. */
  until: number
  /** The viewport at the landing: a rotation or a resize since never arms. */
  width: number
  height: number
}

export interface LandingInput {
  /** The landed flight's station (null for a point flight). */
  landedId: string | null
  /** It was the collapse or resize reframe's own flight: its landing never reopens the window. */
  mine: boolean
  /** It was a flight to the selected train. */
  follows: boolean
  /**
   * The station of the last station fly request when the station panel was in front at the request, else null. A pick
   * made while a train panel is in front (the train clears only after the request) gets no resize reframe.
   */
  flownId: string | null
  focusedId: string | null
  /** The station panel is in front now (no train panel, notice or trip panel over it). */
  stationFront: boolean
  /** The index lists no interior for the landed station. */
  bare: boolean
  /** Another flight started at this landing, or a late interior or streets reframe is pending: that one's landing opens it. */
  flyingOn: boolean
}

/** Whether this landing opens the resize window: a bare station's own flight (or its late streets reframe), not one of ours. */
export function opensResizeWindow(s: LandingInput): boolean {
  if (s.mine || s.follows || s.flyingOn || !s.bare || !s.stationFront) return false
  return s.landedId !== null && s.landedId === s.flownId && s.landedId === s.focusedId
}

export interface PanelMoveInput {
  nowMs: number
  flying: boolean
  following: boolean
  /** A gesture since the landing. */
  tookOver: boolean
  /** A late interior or streets reframe is pending: it reads the panel as it then is. */
  lateArrival: boolean
  focusedId: string | null
  /** The viewport now. */
  width: number
  height: number
  /**
   * The free rect's bottom (interiorFreeRect) before and after the move, px; null with no panel. At a landing, before
   * is the one the landed flight framed in. A desktop side panel never moves it.
   */
  before: number | null
  after: number | null
}

/** Whether a move of the free rect's bottom arms the resize reframe: inside an open window, for its station, at the landing's viewport. */
export function panelMoveArms(w: ResizeWindow | null, s: PanelMoveInput): boolean {
  if (!w || s.nowMs >= w.until || s.focusedId !== w.stationId) return false
  if (s.width !== w.width || s.height !== w.height) return false
  if (s.flying || s.following || s.tookOver || s.lateArrival) return false
  if (s.before === null || s.after === null) return false
  return Math.abs(s.after - s.before) >= 0.5
}
