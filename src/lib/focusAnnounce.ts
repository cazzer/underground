/** How long a newly focused station must stay focused before it is announced (on top of focusDwell's settle). */
export const ANNOUNCE_DELAY_MS = 300

export interface AnnounceInput {
  focusedId: string | null
  /** A train panel or the gone notice sits over the station panel. */
  covered: boolean
  /** Focus was inside the station panel when the station was entered. */
  focusInPanelAtEntry: boolean
  /** Focus is inside the station panel now (the delay has passed). */
  focusInPanelNow: boolean
}

/**
 * Whether the focused station's name is spoken once its delay has passed. Every way a panel opens is covered
 * (camera auto-focus, map tap, link, "Go to" button). It stays silent when focus *entered* the panel meanwhile
 * (a search pick, or a closed train panel handing focus to the heading): that heading speaks. Focus already in
 * the panel when the station changed (the panel isn't keyed by station, so A's heading keeps focus while its
 * text becomes B) did not enter it, so B is announced. Never moves focus.
 */
export function shouldAnnounce({ focusedId, covered, focusInPanelAtEntry, focusInPanelNow }: AnnounceInput): boolean {
  return focusedId !== null && !covered && !(!focusInPanelAtEntry && focusInPanelNow)
}

/** Live-region text for a newly focused station: the name, then the sentence saying it is skipped now when it is (08r.4). */
export function focusAnnouncement(stationName: string, skipSpoken = ''): string {
  return skipSpoken === '' ? `Showing ${stationName}` : `Showing ${stationName}. ${skipSpoken}`
}
