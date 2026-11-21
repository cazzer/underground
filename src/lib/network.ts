/** public/data → render model: projected stations, routes, and shape paths. Pure. */
import { decodeShapePoints } from '../data/codec'
import type { Direction, RouteId, RoutesFile, ShapeId, ShapesFile, StationId, StationsFile, StopId } from '../data/schema'
import { boundsCenter } from './framing'
import { toGround, type Ground } from './projection'

export interface Station {
  id: StationId
  name: string
  pos: Ground
  /** In route_sort_order. */
  routeIds: readonly RouteId[]
  /** Child stop ids (one per platform direction), sorted. */
  stops: readonly StopId[]
}

export interface Route {
  id: RouteId
  shortName: string
  longName: string
  /** '#RRGGBB' as published in GTFS; pass through `routeLineColor` before drawing. */
  color: string
}

export interface ShapePath {
  id: ShapeId
  routeId: RouteId
  direction: Direction
  primary: boolean
  points: Ground[]
  /** Cumulative distance (meters) at each point; last entry is the total length. */
  cumulative: number[]
  length: number
}

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface Network {
  feedVersion: string
  /** Sorted by id. */
  stations: readonly Station[]
  stationById: ReadonlyMap<StationId, Station>
  /** In route_sort_order. */
  routes: readonly Route[]
  routeById: ReadonlyMap<RouteId, Route>
  shapes: readonly ShapePath[]
  /** Covers every station and every shape point. */
  bounds: Bounds
  center: Ground
}

function cumulativeLengths(points: readonly Ground[]): number[] {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  return cumulative
}

function extend(b: Bounds, p: Ground): void {
  if (p.x < b.minX) b.minX = p.x
  if (p.x > b.maxX) b.maxX = p.x
  if (p.z < b.minZ) b.minZ = p.z
  if (p.z > b.maxZ) b.maxZ = p.z
}

export function buildNetwork(stationsFile: StationsFile, routesFile: RoutesFile, shapesFile: ShapesFile): Network {
  const { feedVersion } = stationsFile
  for (const f of [routesFile, shapesFile]) {
    if (f.feedVersion !== feedVersion) {
      throw new Error(`Data files are from different builds: "${feedVersion}" vs "${f.feedVersion}"`)
    }
  }
  if (stationsFile.stations.length === 0) throw new Error('stations.json has no stations')

  const routes = routesFile.routes.map(
    (r): Route => ({ id: r.id, shortName: r.shortName, longName: r.longName, color: `#${r.color}` }),
  )
  const routeById = new Map(routes.map((r) => [r.id, r]))

  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const stations = stationsFile.stations.map((s): Station => {
    const pos = toGround(s)
    extend(bounds, pos)
    return { id: s.id, name: s.name, pos, routeIds: s.routes, stops: s.stops }
  })

  const shapes = shapesFile.shapes.map((s): ShapePath => {
    if (!routeById.has(s.routeId)) throw new Error(`Shape ${s.id} references unknown route "${s.routeId}"`)
    const points = decodeShapePoints(s).map((p) => toGround(p))
    if (points.length < 2) throw new Error(`Shape ${s.id} has ${points.length} point(s); needs at least 2`)
    for (const p of points) extend(bounds, p)
    const cumulative = cumulativeLengths(points)
    return {
      id: s.id,
      routeId: s.routeId,
      direction: s.direction,
      primary: s.primary,
      points,
      cumulative,
      length: cumulative.at(-1)!,
    }
  })

  return {
    feedVersion,
    stations,
    stationById: new Map(stations.map((s) => [s.id, s])),
    routes,
    routeById,
    shapes,
    bounds,
    center: boundsCenter(bounds),
  }
}

/**
 * Position at `distance` meters along the path, clamped to its ends. Writes into `out`
 * (pass one to avoid allocating per call) and returns it.
 */
export function pointAlong(path: ShapePath, distance: number, out: Ground = { x: 0, z: 0 }): Ground {
  const first = path.points[0]
  if (!first) throw new Error(`Shape ${path.id} has no points`)
  if (path.points.length === 1) {
    out.x = first.x
    out.z = first.z
    return out
  }
  const d = Math.min(Math.max(distance, 0), path.length)
  let i = 1
  while (i < path.cumulative.length - 1 && path.cumulative[i]! < d) i++
  const a = path.points[i - 1]!
  const b = path.points[i]!
  const span = path.cumulative[i]! - path.cumulative[i - 1]!
  const t = span === 0 ? 0 : (d - path.cumulative[i - 1]!) / span
  out.x = a.x + (b.x - a.x) * t
  out.z = a.z + (b.z - a.z) * t
  return out
}
