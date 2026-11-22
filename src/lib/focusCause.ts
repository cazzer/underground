/** Who last changed the focused station: the visitor (pick, search, link, button) or the camera's auto-focus. */
export type FocusCause = 'user' | 'camera'

/** How long an auto-focused station must stay focused before it is announced (on top of focusDwell's settle). */
export const ANNOUNCE_DELAY_MS = 300

/** The cause after the camera re-evaluated focus: a newly focused station is the camera's, anything else keeps it. */
export function causeAfterCamera(prevFocusedId: string | null, nextFocusedId: string | null, prev: FocusCause): FocusCause {
  return nextFocusedId !== null && nextFocusedId !== prevFocusedId ? 'camera' : prev
}

export interface AnnounceInput {
  cause: FocusCause
  focusedId: string | null
  /** A train panel or the gone notice sits over the station panel. */
  covered: boolean
  /** Focus is already inside the station panel, so its heading is (or will be) read out. */
  focusInPanel: boolean
}

/** Whether the focused station's name is spoken once its delay has passed. Never moves focus. */
export function shouldAnnounce({ cause, focusedId, covered, focusInPanel }: AnnounceInput): boolean {
  return cause === 'camera' && focusedId !== null && !covered && !focusInPanel
}

/** Live-region text for an auto-focused station: the name alone. */
export function focusAnnouncement(stationName: string): string {
  return `Showing ${stationName}`
}
