/** When the trip panel says "On the map: X" for a station the camera focused behind it. Pure. */

/** After a result settles, a station focused behind the panel stays unannounced this long, so it can't talk over it. */
export const ON_MAP_QUIET_MS = 1500

export interface OnMapInput {
  /** The station the camera now focuses, and the one it focused when this was last checked. */
  focusedId: string | null
  previousId: string | null
  /** The trip panel is open and nothing covers it. */
  shown: boolean
  /** The focused station is already From or To. */
  isEnd: boolean
  planLoading: boolean
  /** Milliseconds since a plan settled; null if none has. */
  sinceSettledMs: number | null
}

/**
 * Whether "On the map: X" is said: only when the focused station really changed while the panel is in front
 * (never on opening, a swap, an end pick or the cover going), it is not an end, and no result is loading or has
 * just settled.
 */
export function shouldAnnounceOnMap(i: OnMapInput): boolean {
  if (i.focusedId === null || i.focusedId === i.previousId || !i.shown || i.isEnd || i.planLoading) return false
  return i.sinceSettledMs === null || i.sinceSettledMs >= ON_MAP_QUIET_MS
}
