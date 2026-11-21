import type { RouteId } from '../../data/schema'
import type { ArrivalGroup } from './arrivals'
import type { StationFeedHealth } from './feedHealth'
import type { LiveStatus } from './liveStatus'

/** What the arrivals list shows: a message alone, or rows (one section per direction) under optional notes. */
export type ArrivalsView =
  | { kind: 'message'; text: string }
  | { kind: 'empty'; notes: string[] }
  | { kind: 'rows'; sections: ArrivalGroup[][]; notes: string[] }

export const DELAYED_NOTE = 'Times may be delayed'

/** Splits groups (already ordered by direction) into one section per direction. */
export function sectionsByDirection(groups: readonly ArrivalGroup[]): ArrivalGroup[][] {
  const sections: ArrivalGroup[][] = []
  for (const g of groups) {
    const last = sections.at(-1)
    if (last && last[0]!.direction === g.direction) last.push(g)
    else sections.push([g])
  }
  return sections
}

/**
 * Which state the arrivals list is in. `groups` is null until there is a snapshot and the join data to read
 * it with. Delayed data keeps its times under a note. A failed feed at this station is said outright and never
 * reads as "no trains", whether or not other rows exist.
 */
export function deriveArrivalsView(
  status: LiveStatus,
  groups: ArrivalGroup[] | null,
  health: StationFeedHealth | null,
  routeName: (id: RouteId) => string,
): ArrivalsView {
  if (status.kind === 'off') return { kind: 'message', text: 'Live arrivals not available yet' }
  if (status.kind === 'error') return { kind: 'message', text: 'Live arrivals unavailable' }
  if (groups === null || health === null) return { kind: 'message', text: 'Connecting to live arrivals' }
  const notes: string[] = []
  if (health.unavailable.length > 0) notes.push(`Live times unavailable for ${health.unavailable.map(routeName).join(', ')}`)
  if (health.delayed) notes.push(DELAYED_NOTE)
  if (groups.length === 0 && health.unavailable.length === 0) return { kind: 'empty', notes }
  return { kind: 'rows', sections: sectionsByDirection(groups), notes }
}
