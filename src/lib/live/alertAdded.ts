/**
 * The stops an Express to Local change adds (08r.8). Pure. The MTA lists the stops of the stretch a route runs local
 * over, the ones it always calls at included; the added stops are those it doesn't call at in normal service. Normal
 * service for a route and direction comes from the trip patterns (one per shape): the primary pattern's stations, plus
 * every other pattern's stop the primary doesn't run past (a branch, an extension), plus the other members of those
 * stations' complexes. A stop only a night or rush pattern calls at between two stations the primary calls at one after
 * the other (the D's 4 Av locals between 36 St and Atlantic Av) is run past, so it isn't normal. Counting every pattern
 * would call the D local on 4 Av; the primary alone would call a branch's stops added.
 */
import type { AlertPeriod, ServiceAlert } from '../../data/realtime'
import type { Direction, RouteId, ShapeId, StationId, TripPattern } from '../../data/schema'
import type { Station } from '../network'
import { primaryKey } from '../realtime/tripLookup'
import { alertKindOf, candidatesOf, headerStopNamed } from './alertStations'

/** The patterns and each route and direction's primary shape (keyed `primaryKey`): a TripLookup fits. */
export interface PatternSource {
  patterns: Readonly<Record<ShapeId, TripPattern>>
  primary: ReadonlyMap<string, ShapeId>
}

export interface RouteService {
  /** The stations the route calls at going this way in normal service, complexes whole. */
  normal: ReadonlySet<StationId>
  /** The primary pattern's stations, in its order. */
  primary: readonly StationId[]
}

/** A route and direction's normal service; null when it has no primary pattern. */
export type ServiceOf = (route: RouteId, direction: Direction) => RouteService | null

/** A child stop's parent station ("A21N" is A21). */
const stationOfStop = (stop: string): StationId => stop.slice(0, -1)

/** Every station's complex, by lead (a station in none is its own). */
function complexes(stationById: ReadonlyMap<StationId, Station>): Map<StationId, StationId[]> {
  const byLead = new Map<StationId, StationId[]>()
  for (const st of stationById.values()) byLead.set(st.leadId, [...(byLead.get(st.leadId) ?? []), st.id])
  return byLead
}

function serviceFor(src: PatternSource, route: RouteId, direction: Direction, members: (id: StationId) => readonly StationId[]): RouteService | null {
  const primaryId = src.primary.get(primaryKey(route, direction))
  const primaryPattern = primaryId === undefined ? undefined : src.patterns[primaryId]
  if (!primaryPattern) return null
  const primary = primaryPattern.stops.map(stationOfStop)
  const at = new Map(primary.map((id, i) => [id, i]))
  const normal = new Set(primary)
  for (const pattern of Object.values(src.patterns)) {
    if (pattern === primaryPattern || pattern.routeId !== route || pattern.direction !== direction) continue
    const stations = pattern.stops.map(stationOfStop)
    stations.forEach((id, i) => {
      if (at.has(id)) return
      let before: number | undefined
      for (let j = i - 1; j >= 0 && before === undefined; j--) before = at.get(stations[j]!)
      let after: number | undefined
      for (let j = i + 1; j < stations.length && after === undefined; j++) after = at.get(stations[j]!)
      const bypassed = before !== undefined && after !== undefined && Math.abs(after - before) === 1
      if (!bypassed) normal.add(id)
    })
  }
  for (const id of [...normal]) for (const m of members(id)) normal.add(m)
  return { normal, primary }
}

/** Normal service by route and direction, each worked out once, on first ask. */
export function serviceIndex(src: PatternSource, stationById: ReadonlyMap<StationId, Station>): ServiceOf {
  const byLead = complexes(stationById)
  const members = (id: StationId): readonly StationId[] => {
    const lead = stationById.get(id)?.leadId
    return lead === undefined ? [] : (byLead.get(lead) ?? [])
  }
  const memo = new Map<string, RouteService | null>()
  return (route, direction) => {
    const key = primaryKey(route, direction)
    if (!memo.has(key)) memo.set(key, serviceFor(src, route, direction, members))
    return memo.get(key)!
  }
}

/** The stations an Express to Local change adds to one route going one way. */
export interface RouteAddedSet {
  alertId: string
  route: RouteId
  direction: Direction
  stations: ReadonlySet<StationId>
  periods: readonly AlertPeriod[]
}

export interface AddedContext {
  stationById: ReadonlyMap<StationId, Station>
  serviceOf: ServiceOf
}

const BOTH: readonly Direction[] = ['N', 'S']

/**
 * Per route and direction of an Express to Local alert (none for any other kind): the informed stations that route
 * doesn't call at going that way in normal service. An entity with no direction counts for both. When the header names
 * stops ("trains stop at 74 St-Broadway") the set narrows to those of them, unless that would leave none. A route and
 * direction with no primary pattern, or nothing added, is omitted; a stop `stationById` lacks is ignored.
 */
export function addedSetsOf(alert: ServiceAlert, ctx: AddedContext): RouteAddedSet[] {
  if (alertKindOf(alert.type) !== 'local') return []
  const entities = alert.entities.filter((e) => e.stop !== null && ctx.stationById.has(e.stop))
  const sets: RouteAddedSet[] = []
  for (const route of new Set(entities.map((e) => e.route))) {
    const ofRoute = entities.filter((e) => e.route === route)
    const allInformed = [...new Set(ofRoute.map((e) => e.stop!))]
    const named = headerStopNamed(alert.header, candidatesOf(ctx.stationById, route, allInformed))
    for (const direction of BOTH) {
      const service = ctx.serviceOf(route, direction)
      if (service === null) continue
      const informed = new Set(ofRoute.filter((e) => e.direction === null || e.direction === direction).map((e) => e.stop!))
      const added = [...informed].filter((id) => !service.normal.has(id))
      const narrowed = added.filter((id) => named.has(id))
      const stations = narrowed.length > 0 ? narrowed : added
      if (stations.length > 0) sets.push({ alertId: alert.id, route, direction, stations: new Set(stations), periods: alert.periods })
    }
  }
  return sets
}
