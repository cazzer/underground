/**
 * What a service change's drawing reads (08r.6, 08r.8), and how it puts an alert's stations in order on its route.
 * Pure. Shared by changeDraw.ts and changeDrawStops.ts.
 */
import type { ServiceAlert } from '../data/realtime'
import type { Direction, RouteId, StationId, StopId } from '../data/schema'
import type { ServiceOf } from './live/alertAdded'
import type { Station } from './network'
import { projectForward } from './realtime/polyline'
import { MAX_STOP_OFFSET_M, type SpanShape } from './tripSpans'

export interface ChangeDrawContext {
  /** The drawn shapes (banded once the bands arrive): the stretches are found on what TripLines draws. */
  shapes: readonly SpanShape[]
  stationById: ReadonlyMap<StationId, Station>
  stopStations: ReadonlyMap<StopId, Station>
  /** Normal service by route and direction (alertAdded.ts), for an Express to Local change; null while the trip patterns load. */
  serviceOf: ServiceOf | null
}

export const BOTH: readonly Direction[] = ['N', 'S']
const START = { segment: 0, t: 0 }

/** The stations of `route` the alert lists, each once in feed order (a station the network lacks is left out). */
export function informedOf(alert: ServiceAlert, route: RouteId, stationById: ReadonlyMap<StationId, Station>): StationId[] {
  const ids = alert.entities.filter((e) => e.route === route && e.stop !== null && stationById.has(e.stop)).map((e) => e.stop!)
  return [...new Set(ids)]
}

/**
 * The stations' child stops of `direction`, in order along the route's first shape of that direction (primary first,
 * then by id) that passes within MAX_STOP_OFFSET_M of all of them; null when no shape does. A station with no stop of
 * that direction (a terminal's) is left out.
 */
export function orderedRun(route: RouteId, direction: Direction, ids: readonly StationId[], ctx: ChangeDrawContext): StopId[] | null {
  const stops = ids.flatMap((id) => {
    const station = ctx.stationById.get(id)
    const stop = station?.stops.find((s) => s.endsWith(direction))
    return station && stop ? [{ stop, pos: station.pos }] : []
  })
  if (stops.length === 0) return null
  const shapes = ctx.shapes
    .filter((s) => s.routeId === route && s.direction === direction)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const shape of shapes) {
    const hits = stops.map((s) => projectForward(shape, s.pos, START))
    if (hits.every((h) => h.offsetM <= MAX_STOP_OFFSET_M)) {
      return stops.map((s, i) => ({ stop: s.stop, d: hits[i]!.distance })).sort((a, b) => a.d - b.d).map((s) => s.stop)
    }
  }
  return null
}
