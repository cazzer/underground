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

/** Member id to lead id (a lead maps to itself), validated: known ids, 2+ members, no id twice (throws, naming stations.json). */
export function stationLeads(
  complexes: readonly (readonly StationId[])[],
  known: ReadonlySet<StationId>,
): ReadonlyMap<StationId, StationId> {
  const leads = new Map<StationId, StationId>()
  for (const members of complexes) {
    if (members.length < 2) throw new Error(`stations.json complexes: ${JSON.stringify(members)} has fewer than 2 stations`)
    for (const id of members) {
      if (!known.has(id)) throw new Error(`stations.json complexes: ${id} is not a station`)
      if (leads.has(id)) throw new Error(`stations.json complexes: ${id} is in two complexes`)
      leads.set(id, members[0]!)
    }
  }
  return leads
}

/** The most common member name, a tie going to the earliest member's (the lead's); the other distinct names in member order. */
export function groupName(members: readonly { name: string }[]): { name: string; otherNames: string[] } {
  const counts = new Map<string, number>()
  for (const m of members) counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
  let name = members[0]!.name
  for (const [candidate, n] of counts) if (n > counts.get(name)!) name = candidate
  return { name, otherNames: [...counts.keys()].filter((n) => n !== name) }
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
 * accessible member " only" ends it ("L, N, Q, R, W only").
 */
export function groupAccess(
  members: readonly Pick<Station, 'routeIds' | 'access'>[],
  routeName: (id: RouteId) => string,
): StationAccessInfo {
  if (members.every((m) => m.access.status === 'full')) return { status: 'full' }
  if (members.every((m) => m.access.status === 'none')) return { status: 'none' }
  const full = members.filter((m) => m.access.status === 'full')
  const partial = members.filter((m) => m.access.status === 'partial')
  const parts: string[] = []
  if (full.length > 0) parts.push(noteRoutes(full.flatMap((m) => m.routeIds), routeName))
  for (const m of partial) {
    parts.push(m.access.note ? `${noteRoutes(m.routeIds, routeName)} ${m.access.note}` : noteRoutes(m.routeIds, routeName))
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
      const routeIds = [...new Set(members.flatMap((m) => m.routeIds))].sort(
        (a, b) => (routeOrder.get(a) ?? Infinity) - (routeOrder.get(b) ?? Infinity),
      )
      group = {
        ...s,
        name,
        routeIds,
        stops: [...new Set(members.flatMap((m) => m.stops))].sort(),
        access: groupAccess(members, routeName),
        memberIds: ids,
        otherNames,
      }
    }
    groups.push(group)
    for (const id of group.memberIds) groupById.set(id, group)
  }
  return { groups, groupById }
}
