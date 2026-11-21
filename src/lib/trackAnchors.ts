/**
 * Where each authored platform track lies along the shapes that stop there: the runs a shape's vertical
 * profile is anchored to (trackProfile.ts). Pure. Explicit `.ts` imports because scripts/lib/trackDepth.test.ts
 * loads this file in Node.
 */
import type { Direction, RouteId, ShapeId, StationId, StopId } from '../data/schema.ts'
import type { StationDepthsFile } from '../data/stationSchema.ts'
import { toGround } from './projection.ts'
import { projectForward, type Polyline } from './realtime/polyline.ts'
import type { ProfileRun } from './trackProfile.ts'

/** Both ends of a platform track must lie this close to a shape's track line for the shape to ride it. */
export const MATCH_TOL_M = 6

export interface AnchorStation {
  id: StationId
  routeIds: readonly RouteId[]
}

export interface AnchorShape {
  id: ShapeId
  routeId: RouteId
  direction: Direction
  /** The drawn track line (trackLine), before any profile resampling. */
  line: Polyline
}

export interface AnchoredRuns {
  /** Runs per shape, for each shape that rides at least one authored track. */
  runs: Map<ShapeId, ProfileRun[]>
  /** Authored tracks no shape rides (wrong data, or the shapes moved); their stations keep street-level tracks. */
  unmatched: StopId[]
}

const START = { segment: 0, t: 0 }

/**
 * A shape rides a track when its route serves the track's station, its direction is the stop id's suffix
 * (L08N is northbound), and both track ends project onto its line within MATCH_TOL_M. The run spans the two
 * projected distances, tagged with the station. Shapes passing the station once (all of them today) project correctly from the start.
 */
export function profileRuns(
  depths: StationDepthsFile,
  stations: readonly AnchorStation[],
  shapes: readonly AnchorShape[],
): AnchoredRuns {
  const routesAt = new Map(stations.map((s) => [s.id, new Set(s.routeIds)]))
  const runs = new Map<ShapeId, ProfileRun[]>()
  const unmatched: StopId[] = []
  for (const station of depths.stations) {
    const routes = routesAt.get(station.stationId)
    const origin = toGround(station.anchor)
    for (const track of station.tracks) {
      const direction = track.stopId.at(-1)
      const [a, b] = track.ends.map(([x, z]) => ({ x: origin.x + x, z: origin.z + z }))
      let matched = false
      for (const shape of shapes) {
        if (shape.direction !== direction || !routes?.has(shape.routeId)) continue
        const hitA = projectForward(shape.line, a!, START)
        const hitB = projectForward(shape.line, b!, START)
        if (hitA.offsetM > MATCH_TOL_M || hitB.offsetM > MATCH_TOL_M) continue
        const run: ProfileRun = {
          d0: Math.min(hitA.distance, hitB.distance),
          d1: Math.max(hitA.distance, hitB.distance),
          yReal: track.railY,
          stationId: station.stationId,
        }
        const list = runs.get(shape.id)
        if (list) list.push(run)
        else runs.set(shape.id, [run])
        matched = true
      }
      if (!matched) unmatched.push(track.stopId)
    }
  }
  return { runs, unmatched }
}
