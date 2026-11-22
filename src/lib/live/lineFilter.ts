import type { RouteId } from '../../data/schema'
import type { ArrivalGroup } from './arrivals'

/** One chip of the station panel's line filter: a line, with its express variant folded in (6X into 6). */
export interface LineChoice {
  key: string
  /** The route the chip draws: the line's own route, else its express variant. */
  routeId: RouteId
  /** Every route of the line at the station, in route order. */
  routeIds: readonly RouteId[]
}

/** "6X" → "6", "FX" → "F", "7X" → "7"; any other route id (GS, FS, H, SI) is its own line. */
export function lineKey(routeId: RouteId): string {
  const m = /^([0-9A-Z])X$/.exec(routeId)
  return m ? m[1]! : routeId
}

/**
 * The station's lines, in `routeOrder` (its routes; for a complex, every member's), an express folded into its line.
 * Fixed by the station, never by arrivals, so a poll can't move a chip. Empty under two lines: nothing to choose between.
 */
export function stationLines(routeOrder: readonly RouteId[]): LineChoice[] {
  const byKey = new Map<string, RouteId[]>()
  for (const id of routeOrder) {
    const key = lineKey(id)
    const list = byKey.get(key)
    if (list) list.push(id)
    else byKey.set(key, [id])
  }
  if (byKey.size < 2) return []
  return [...byKey].map(([key, routeIds]) => ({ key, routeId: routeIds.find((id) => id === key) ?? routeIds[0]!, routeIds }))
}

/** The lines that have a group in `groups` (unfiltered), so a chip can say none is due. */
export function linesDue(groups: readonly ArrivalGroup[]): Set<string> {
  return new Set(groups.map((g) => lineKey(g.routeId)))
}

/** The filter's state: a line and the station it was chosen at, so it reads as unset anywhere else. */
export interface LineFilterState {
  stationId: string | null
  line: string | null
}

export const NO_FILTER: LineFilterState = { stationId: null, line: null }

/** The chosen line at `stationId`; null for no filter, and for a filter chosen at another station. */
export function lineOf(state: LineFilterState, stationId: string | null): string | null {
  return stationId !== null && state.stationId === stationId ? state.line : null
}

/** Tapping the chip of the chosen line clears the filter; any other chip chooses its line (one at a time). */
export function toggledFilter(state: LineFilterState, stationId: string, key: string): LineFilterState {
  return lineOf(state, stationId) === key ? { stationId, line: null } : { stationId, line: key }
}

/** The groups of one line (express variants included), in their order; every group for a null line. */
export function filterArrivals(groups: readonly ArrivalGroup[], line: string | null): ArrivalGroup[] {
  return line === null ? [...groups] : groups.filter((g) => lineKey(g.routeId) === line)
}

/** What the filter's polite line says after a tap: the chosen line's spoken name and its destinations, or all trains. */
export function lineFilterAnnouncement(spoken: string | null, destinations: number): string {
  if (spoken === null) return 'Showing all trains'
  if (destinations === 0) return `Showing ${spoken} trains, none due`
  return `Showing ${spoken} trains, ${destinations} ${destinations === 1 ? 'destination' : 'destinations'}`
}
