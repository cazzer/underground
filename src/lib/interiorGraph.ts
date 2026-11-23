/**
 * The quickest way from a platform track to each street exit (and from each street entry to it), over the interior route graph (interiorGraphCore.ts):
 * its connectors and same-area walks, plus one node per exit entrance and the walk from a street end to the entrance
 * that lists it. All times are seconds; rises are real, never the drawn exaggeration.
 */
import type { StopId } from '../data/schema'
import type { Endpoint, LocalPoint, StationInterior } from '../data/stationSchema'
import { areaIndex, areaOf, buildInteriorGraph, dist, pathBack, shortestFrom, stopTracks } from './interiorGraphCore'
import { nearestOnPolyline } from './planGeometry'
import { WALK_SPEED_MPS } from './walkRoute'

export { CONTAINMENT_M, ELEVATOR_MPS, ELEVATOR_WAIT_S, ESCALATOR_MPS, STAIR_MPS } from './interiorGraphCore'

/** Where a route meets the street: an entrance, or the street end of a connector no entrance lists. */
export interface StreetExit {
  entranceId: string | null
  /** Interior-local. */
  point: LocalPoint
  /** The entrance's raw type; null for an unlisted end. */
  type: string | null
}

export interface InStationRoute {
  /** Where the route meets the street: the exit a rider leaves by, or for a way in (`routesFromStreet`) the entry. */
  exit: StreetExit
  /** Between the track and the street, whichever way the route is ridden. */
  seconds: number
  /** Platform to street: travel order for a way out, the reverse of it for a way in. */
  connectorIds: string[]
  /** The platform first, then each slab stood on. */
  areaIds: string[]
  /** The first connector end, on the platform. */
  platformPoint: LocalPoint
  /** Where `platformPoint` projects on the alighting track's path, 0..1 from `path[0]` (path order is not travel order). */
  trackShare: number
}

export interface InteriorRouteOptions {
  /** Only elevators, ramps and walkways. */
  stepFree?: boolean
  /** Connector ids out of service. */
  closed?: ReadonlySet<string>
}

/** The id of the platform or slab an endpoint stands on: its authored `area`, else containment (the nearest outline
 *  within `CONTAINMENT_M`, ties by id); null on the street level. Throws when there is none. */
export function endpointArea(interior: StationInterior, end: Endpoint): string | null {
  return areaOf(interior, areaIndex(interior), end)
}

/**
 * The quickest in-station route from a platform track of `stopId` to every street exit that can be reached, sorted by
 * time (ties in exit order: the entrances, then unlisted street ends). Null when no platform track serves `stopId`;
 * an empty list when none of them reaches an exit (for instance step-free with no elevator). Exits may cross unpaid
 * areas (a rider leaving needs no fare).
 */
export function routesToStreet(interior: StationInterior, stopId: StopId, opts: InteriorRouteOptions = {}): InStationRoute[] | null {
  return streetRoutes(interior, stopId, opts, 'out')
}

/**
 * The quickest in-station route from every street entry that can reach a platform track of `stopId` (an entrance marked
 * `entry`, or the street end of a connector no entrance lists), sorted by time as `routesToStreet`. The search runs from
 * the track over the graph reversed (`reverse`), so a one-way escalator is only ever ridden the way it runs; each route
 * still lists the platform first. Null and empty as for `routesToStreet`.
 */
export function routesFromStreet(interior: StationInterior, stopId: StopId, opts: InteriorRouteOptions = {}): InStationRoute[] | null {
  return streetRoutes(interior, stopId, opts, 'in')
}

function streetRoutes(interior: StationInterior, stopId: StopId, opts: InteriorRouteOptions, way: 'out' | 'in'): InStationRoute[] | null {
  const tracks = stopTracks(interior, stopId)
  if (tracks.length === 0) return null
  const graph = buildInteriorGraph(interior, { ...opts, reverse: way === 'in' })
  const { nodes, streetEnd } = graph

  interface Exit extends StreetExit {
    node: number
  }
  const exits: Exit[] = []
  const listed = new Set<string>()
  for (const e of interior.entrances) {
    for (const id of e.connectors) listed.add(id)
    if (!(way === 'out' ? e.exit : e.entry)) continue
    const node = graph.addNode([e.x, e.z], null)
    exits.push({ entranceId: e.id, point: [e.x, e.z], type: e.type, node })
    for (const id of e.connectors) {
      const end = streetEnd.get(id)
      if (end !== undefined) graph.link(end, node, dist(nodes[end]!.point, [e.x, e.z]) / WALK_SPEED_MPS, null)
    }
  }
  for (const [id, node] of streetEnd) if (!listed.has(id)) exits.push({ entranceId: null, point: nodes[node]!.point, type: null, node })

  const search = shortestFrom(graph, tracks)
  const routes: InStationRoute[] = []
  exits.forEach((exit) => {
    if (search.d[exit.node]! === Infinity) return
    const { nodes: path, connectorIds, areaIds } = pathBack(graph, search, exit.node)
    const first = path[0]!
    const hit = nearestOnPolyline(tracks[search.track[first]!]!.path, nodes[first]!.point)
    const { node: _node, ...streetExit } = exit
    routes.push({
      exit: streetExit,
      seconds: search.d[exit.node]!,
      connectorIds,
      areaIds,
      platformPoint: nodes[first]!.point,
      trackShare: hit.total === 0 ? 0 : hit.along / hit.total,
    })
  })
  return routes.map((r, i) => ({ r, i })).sort((a, b) => a.r.seconds - b.r.seconds || a.i - b.i).map(({ r }) => r)
}
