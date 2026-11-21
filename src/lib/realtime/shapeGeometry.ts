import type { ShapeId, ShapesFile, StationsFile, StopId, TripIndexFile } from '../../data/schema'
import { toGround, type Ground } from '../projection'
import { trackLine } from '../trackLine'
import { buildPolyline, projectForward, type Polyline } from './polyline'

export interface ShapeGeometry {
  shapeId: ShapeId
  line: Polyline
  stops: readonly StopId[]
  /** Distance along `line` of each stop; same length as `stops`, non-decreasing. */
  stopDistances: readonly number[]
  /** Largest distance from a stop to the track line; a sanity bound, not used in positioning. */
  maxStopOffsetM: number
}

/**
 * Builds each pattern's line with `trackLine(shape, trackOffsetM)`, the same line the map draws, so
 * dots ride their direction's track (at offset 0 it is still spur-dropped, not the raw shape). Then
 * projects the stops onto it, forward-only so distances never decrease (even on hairpins). Throws if
 * a pattern stop has no station or a pattern has no shape.
 */
export function buildShapeGeometries(
  shapes: ShapesFile,
  index: TripIndexFile,
  stations: StationsFile,
  trackOffsetM: number,
): Map<ShapeId, ShapeGeometry> {
  const stopGround = new Map<StopId, Ground>()
  for (const st of stations.stations) {
    const g = toGround(st)
    for (const stop of st.stops) stopGround.set(stop, g)
  }
  const shapeById = new Map(shapes.shapes.map((s) => [s.id, s]))

  const out = new Map<ShapeId, ShapeGeometry>()
  for (const [shapeId, pattern] of Object.entries(index.patterns)) {
    const shape = shapeById.get(shapeId)
    if (!shape) throw new Error(`pattern ${shapeId} has no shape`)
    const line = buildPolyline(trackLine(shape, trackOffsetM))
    let cursor = { segment: 0, t: 0 }
    let maxStopOffsetM = 0
    const stopDistances = pattern.stops.map((stop) => {
      const g = stopGround.get(stop)
      if (!g) throw new Error(`stop ${stop} on pattern ${shapeId} has no station`)
      const hit = projectForward(line, g, cursor)
      cursor = { segment: hit.segment, t: hit.t }
      maxStopOffsetM = Math.max(maxStopOffsetM, hit.offsetM)
      return hit.distance
    })
    out.set(shapeId, { shapeId, line, stops: pattern.stops, stopDistances, maxStopOffsetM })
  }
  return out
}
