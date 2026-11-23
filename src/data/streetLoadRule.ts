/** When the street layer store (useStationStreets.ts) asks for a layer again. Pure. */

/** How old a layer that lacks a failed member's entrances is before a hook asking for it tries that member again, ms. */
export const PARTIAL_RETRY_MS = 5000

/**
 * Whether a hook asking for a layer (on mount or a key change) starts a load of it. Never while one is in flight. A
 * loaded layer (`hit`) is asked again only when it lacks members (`missing`) and is PARTIAL_RETRY_MS old. A key with no
 * layer whose last load failed is asked again at once, unless `failedRecent` (a view-driven caller whose failure is
 * still inside VIEW_RETRY_MS, viewStations.ts) holds it back.
 */
export function requestDue(
  hit: { missing: number; at: number } | undefined,
  pending: boolean,
  failedRecent: boolean,
  nowMs: number,
): boolean {
  if (pending) return false
  if (hit) return hit.missing > 0 && nowMs - hit.at >= PARTIAL_RETRY_MS
  return !failedRecent
}
