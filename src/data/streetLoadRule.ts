/** When the street layer store (useStationStreets.ts) asks for a layer again. Pure. */
import { VIEW_RETRY_MS } from '../lib/viewStations'

/** How old a layer that lacks a failed member's entrances is before a hook asking for it tries that member again, ms. */
export const PARTIAL_RETRY_MS = 5000

/**
 * Whether a hook asking for a layer (on mount or a key change) starts a load of it. Never while one is in flight. A
 * loaded layer (`hit`) is asked again only when it lacks members (`missing`) and is PARTIAL_RETRY_MS old. A key with no
 * layer whose last load failed (`failedAtMs`) is asked again at once. A view-driven caller (o3r.5's streets in view,
 * which ask on every change of the set) holds both back for VIEW_RETRY_MS (viewStations.ts) instead.
 */
export function requestDue(
  hit: { missing: number; at: number } | undefined,
  pending: boolean,
  failedAtMs: number | undefined,
  nowMs: number,
  viewDriven: boolean,
): boolean {
  if (pending) return false
  if (hit) return hit.missing > 0 && nowMs - hit.at >= (viewDriven ? Math.max(PARTIAL_RETRY_MS, VIEW_RETRY_MS) : PARTIAL_RETRY_MS)
  return failedAtMs === undefined || !viewDriven || nowMs - failedAtMs >= VIEW_RETRY_MS
}
