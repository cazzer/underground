/**
 * The trip's station marks (TripMarks.tsx, 2q7.45.4). Pure: where the journey boards, changes and alights, and every
 * station it calls at (the ones that keep their full ring while the network dims).
 */
import type { StationId, StopId } from '../data/schema'
import type { Station } from './network'
import type { Ground } from './projection'

/** `start` and `end` draw filled, `change` hollow. */
export type TripMarkRole = 'start' | 'change' | 'end'

export interface TripMark {
  stationId: StationId
  pos: Ground
  role: TripMarkRole
}

/** The fields of a trip leg the marks read: a ride's stops (board to alight) or a walk's two stops. */
export type MarkLeg = { kind: 'ride'; stops: readonly StopId[] } | { kind: 'walk'; fromStop: StopId; toStop: StopId }

function stationOf(stopStations: ReadonlyMap<StopId, Station>, stop: StopId): Station {
  const station = stopStations.get(stop)
  if (!station) throw new Error(`Trip leg names stop "${stop}", which no station lists`)
  return station
}

/** A leg's first and last stop: where it is boarded or left from, and where it ends. */
function legEnds(leg: MarkLeg): [StopId, StopId] {
  if (leg.kind === 'walk') return [leg.fromStop, leg.toStop]
  const first = leg.stops[0]
  const last = leg.stops.at(-1)
  if (first === undefined || last === undefined) throw new Error('Trip ride leg has no stops')
  return [first, last]
}

/**
 * One mark per station, in journey order: the first leg's start (a leading walk's origin included) is `start`, the
 * last leg's end is `end`, every other leg boundary a `change`. A station named twice keeps one mark, `start` or `end`
 * over `change` (a change inside one station names it twice). A walk between a complex's members marks each member,
 * since each keeps its own marker on its line. Throws for a stop no station lists.
 */
export function tripMarks(legs: readonly MarkLeg[], stopStations: ReadonlyMap<StopId, Station>): TripMark[] {
  if (legs.length === 0) return []
  const stops = legs.flatMap(legEnds)
  const byId = new Map<StationId, TripMark>()
  stops.forEach((stop, i) => {
    const station = stationOf(stopStations, stop)
    const role: TripMarkRole = i === 0 ? 'start' : i === stops.length - 1 ? 'end' : 'change'
    const had = byId.get(station.id)
    if (!had) byId.set(station.id, { stationId: station.id, pos: { x: station.pos.x, z: station.pos.z }, role })
    else if (had.role === 'change' && role !== 'change') had.role = role
  })
  return [...byId.values()]
}

/** Every station the journey calls at, passed through or walked to, each once in journey order. Throws for an unknown stop. */
export function tripStationIds(legs: readonly MarkLeg[], stopStations: ReadonlyMap<StopId, Station>): StationId[] {
  const ids = new Set<StationId>()
  for (const leg of legs) {
    const stops = leg.kind === 'ride' ? leg.stops : [leg.fromStop, leg.toStop]
    for (const stop of stops) ids.add(stationOf(stopStations, stop).id)
  }
  return [...ids]
}
