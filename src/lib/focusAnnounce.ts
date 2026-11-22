/** How long a newly focused station must stay focused before it is announced (on top of focusDwell's settle). */
export const ANNOUNCE_DELAY_MS = 300

export interface AnnounceInput {
  focusedId: string | null
  /** A train panel or the gone notice sits over the station panel. */
  covered: boolean
  /** Focus is already inside the station panel, so its heading is (or will be) read out. */
  focusInPanel: boolean
}

/**
 * Whether the focused station's name is spoken once its delay has passed. Every way a panel opens is covered
 * (camera auto-focus, map tap, link, "Go to" button); only search moves focus to the heading itself, which
 * `focusInPanel` leaves silent. Never moves focus.
 */
export function shouldAnnounce({ focusedId, covered, focusInPanel }: AnnounceInput): boolean {
  return focusedId !== null && !covered && !focusInPanel
}

/** Live-region text for a newly focused station: the name alone. */
export function focusAnnouncement(stationName: string): string {
  return `Showing ${stationName}`
}
