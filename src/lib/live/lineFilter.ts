import type { RouteId } from '../../data/schema'
import type { ArrivalGroup } from './arrivals'

/** One chip of the station panel's line filter: a line, with its express variant folded in (6X into 6). */
export interface LineChoice {
  key: string
  /** The route the chip draws: the line's own route when it has arrivals, else its express variant. */
  routeId: RouteId
  /** Every route of the line that has arrivals, in the station's route order. */
  routeIds: readonly RouteId[]
}

/** "6X" → "6", "FX" → "F", "7X" → "7"; any other route id (GS, FS, H, SI) is its own line. */
export function lineKey(routeId: RouteId): string {
  const m = /^([0-9A-Z])X$/.exec(routeId)
  return m ? m[1]! : routeId
}

/**
 * The lines with arrivals in `groups`, in `routeOrder` (the station's routes; a route it lacks goes last, in the
 * order the groups name it). Empty when under two lines: there is nothing to choose between.
 */
export function arrivalLines(routeOrder: readonly RouteId[], groups: readonly ArrivalGroup[]): LineChoice[] {
  const present = new Set(groups.map((g) => g.routeId))
  const ids = [...routeOrder.filter((id) => present.has(id)), ...[...present].filter((id) => !routeOrder.includes(id))]
  const byKey = new Map<string, RouteId[]>()
  for (const id of ids) {
    const key = lineKey(id)
    const list = byKey.get(key)
    if (list) list.push(id)
    else byKey.set(key, [id])
  }
  if (byKey.size < 2) return []
  return [...byKey].map(([key, routeIds]) => ({ key, routeId: routeIds.find((id) => id === key) ?? routeIds[0]!, routeIds }))
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

/** The line to filter by: `line` while it has a chip (arrivals), else null, so a line that went quiet shows every line. */
export function resolveLine(line: string | null, choices: readonly LineChoice[]): string | null {
  return line !== null && choices.some((c) => c.key === line) ? line : null
}

/** The groups of one line (express variants included), in their order; every group for a null line. */
export function filterArrivals(groups: readonly ArrivalGroup[], line: string | null): ArrivalGroup[] {
  return line === null ? [...groups] : groups.filter((g) => lineKey(g.routeId) === line)
}

/** What the filter's polite line says after a tap: the chosen line's spoken name, or null for every line. */
export function lineFilterAnnouncement(spoken: string | null): string {
  return spoken === null ? 'Showing all trains' : `Showing ${spoken} trains`
}
