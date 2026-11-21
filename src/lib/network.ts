import { SAMPLE_LINES, SAMPLE_STATIONS, type SampleLine, type SampleStation } from '../data/sample'
import { toGround, type Ground } from './projection'

export interface Station {
  id: string
  name: string
  pos: Ground
  lineIds: string[]
}

export interface Route {
  id: string
  name: string
  /** Index into the theme's line palette. */
  colorIndex: number
  points: Ground[]
  /** Cumulative distance (meters) at each point; last entry is the total length. */
  cumulative: number[]
  length: number
}

export interface Network {
  stations: Station[]
  routes: Route[]
  /** Center of the stations' bounding box, used to frame the initial camera. */
  center: Ground
}

export function buildNetwork(
  rawStations: readonly SampleStation[],
  rawLines: readonly SampleLine[],
): Network {
  const byId = new Map(rawStations.map((s) => [s.id, s]))
  const lineIdsByStation = new Map<string, string[]>()

  const routes = rawLines.map((line, colorIndex): Route => {
    const points = line.stops.map((stop) => {
      if (typeof stop === 'string') {
        const station = byId.get(stop)
        if (!station) throw new Error(`Line ${line.id} references unknown station "${stop}"`)
        lineIdsByStation.set(stop, [...(lineIdsByStation.get(stop) ?? []), line.id])
        return toGround(station)
      }
      return toGround(stop)
    })
    const cumulative = [0]
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
    }
    return { id: line.id, name: line.name, colorIndex, points, cumulative, length: cumulative.at(-1) ?? 0 }
  })

  const stations = rawStations.map((s): Station => ({
    id: s.id,
    name: s.name,
    pos: toGround(s),
    lineIds: lineIdsByStation.get(s.id) ?? [],
  }))

  const xs = stations.map((s) => s.pos.x)
  const zs = stations.map((s) => s.pos.z)
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  }
  return { stations, routes, center }
}

/**
 * Position at `distance` meters along the route, clamped to its ends. Writes into `out`
 * (pass one to avoid allocating per call) and returns it.
 */
export function pointAlong(route: Route, distance: number, out: Ground = { x: 0, z: 0 }): Ground {
  const first = route.points[0]
  if (!first) throw new Error(`Route ${route.id} has no points`)
  if (route.points.length === 1) {
    out.x = first.x
    out.z = first.z
    return out
  }
  const d = Math.min(Math.max(distance, 0), route.length)
  let i = 1
  while (i < route.cumulative.length - 1 && route.cumulative[i]! < d) i++
  const a = route.points[i - 1]!
  const b = route.points[i]!
  const span = route.cumulative[i]! - route.cumulative[i - 1]!
  const t = span === 0 ? 0 : (d - route.cumulative[i - 1]!) / span
  out.x = a.x + (b.x - a.x) * t
  out.z = a.z + (b.z - a.z) * t
  return out
}

export const network: Network = buildNetwork(SAMPLE_STATIONS, SAMPLE_LINES)
