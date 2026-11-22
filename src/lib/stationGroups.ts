/** Station complexes as one station for the UI (marker, search, focus, panel). Pure; the data is stations.json's
 *  `complexes` (the catalog's complex_id, lead first: scripts/lib/stationComplexes.ts). */
import type { RouteId, StationId } from '../data/schema'
import type { Station, StationAccessInfo } from './network'

export interface StationGroup extends Station {
  /** Every member, the lead (this id) first, then by id; [id] for a lone station. */
  memberIds: readonly StationId[]
  /** The members' other distinct names, in member order; none for a lone station. */
  otherNames: readonly string[]
}

export { stationLeads } from './stationLeads'

/** The most common member name, a tie going to the earliest member's (the lead's); the other distinct names in member order. */
export function groupName(members: readonly { name: string }[]): { name: string; otherNames: string[] } {
  const counts = new Map<string, number>()
  for (const m of members) counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
  let name = members[0]!.name
  for (const [candidate, n] of counts) if (n > counts.get(name)!) name = candidate
  return { name, otherNames: [...counts.keys()].filter((n) => n !== name) }
}

/** Route order, then id for routes the order doesn't know (never NaN: Infinity - Infinity). */
function byRouteOrder(routeOrder: ReadonlyMap<RouteId, number>): (a: RouteId, b: RouteId) => number {
  return (a, b) => {
    const oa = routeOrder.get(a)
    const ob = routeOrder.get(b)
    if (oa !== undefined && ob !== undefined) return oa - ob || (a < b ? -1 : a > b ? 1 : 0)
    if (oa !== undefined) return -1
    if (ob !== undefined) return 1
    return a < b ? -1 : a > b ? 1 : 0
  }
}

/** Route names for a note: short names in order, once each, an express variant ("6X") dropped when its base ("6") is listed. */
function noteRoutes(routeIds: readonly RouteId[], routeName: (id: RouteId) => string): string {
  const names = [...new Set(routeIds.map(routeName))]
  const kept = names.filter((n) => {
    const base = /^([0-9A-Z])X$/.exec(n)?.[1]
    return base === undefined || !names.includes(base)
  })
  return kept.join(', ')
}

/**
 * The access of a complex: all full is full, all none is none, else partial. The note lists the fully accessible
 * members' routes, then each partly accessible member's routes and its own note, "; "-separated; with no partly
 * accessible member " only" ends it ("L, N, Q, R, W only"). Routes are in `routeOrder`.
 */
export function groupAccess(
  members: readonly Pick<Station, 'routeIds' | 'access'>[],
  routeName: (id: RouteId) => string,
  routeOrder: ReadonlyMap<RouteId, number> = new Map(),
): StationAccessInfo {
  const inOrder = byRouteOrder(routeOrder)
  if (members.every((m) => m.access.status === 'full')) return { status: 'full' }
  if (members.every((m) => m.access.status === 'none')) return { status: 'none' }
  const full = members.filter((m) => m.access.status === 'full')
  const partial = members.filter((m) => m.access.status === 'partial')
  const parts: string[] = []
  if (full.length > 0) parts.push(noteRoutes([...new Set(full.flatMap((m) => m.routeIds))].sort(inOrder), routeName))
  for (const m of partial) {
    const routes = noteRoutes([...m.routeIds].sort(inOrder), routeName)
    parts.push(m.access.note ? `${routes} ${m.access.note}` : routes)
  }
  const note = parts.join('; ')
  return { status: 'partial', note: partial.length === 0 ? `${note} only` : note }
}

/**
 * One group per lone station and per complex, in `stations` order at the lead's place (so sorted by id, the lead's
 * id, position, borough and leadId). A complex's routes and stops are its members' union (routes in `routeOrder`,
 * stops sorted). `groupById` holds every station id, a member too.
 */
export function buildStationGroups(
  stations: readonly Station[],
  complexes: readonly (readonly StationId[])[],
  routeOrder: ReadonlyMap<RouteId, number>,
  routeName: (id: RouteId) => string,
): { groups: StationGroup[]; groupById: Map<StationId, StationGroup> } {
  const byId = new Map(stations.map((s) => [s.id, s]))
  const membersByLead = new Map(complexes.map((c) => [c[0]!, c]))
  const lone = (s: Station): StationGroup => ({ ...s, memberIds: [s.id], otherNames: [] })
  const memberOfOther = new Set(complexes.flatMap((c) => c.slice(1)))
  const groups: StationGroup[] = []
  const groupById = new Map<StationId, StationGroup>()
  for (const s of stations) {
    if (memberOfOther.has(s.id)) continue
    const ids = membersByLead.get(s.id)
    let group: StationGroup
    if (ids === undefined) {
      group = lone(s)
    } else {
      const members = ids.map((id) => {
        const m = byId.get(id)
        if (!m) throw new Error(`stations.json complexes: ${id} is not a station`)
        return m
      })
      const { name, otherNames } = groupName(members)
      const routeIds = [...new Set(members.flatMap((m) => m.routeIds))].sort(byRouteOrder(routeOrder))
      group = {
        ...s,
        name,
        routeIds,
        stops: [...new Set(members.flatMap((m) => m.stops))].sort(),
        access: groupAccess(members, routeName, routeOrder),
        memberIds: ids,
        otherNames,
      }
    }
    groups.push(group)
    for (const id of group.memberIds) groupById.set(id, group)
  }
  return { groups, groupById }
}
