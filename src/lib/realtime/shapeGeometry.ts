import type { ShapeId, ShapesFile, StationsFile, StopId, TripIndexFile } from '../../data/schema'
import { vertexBandInputs } from '../lineBuffers'
import type { DrawnTrack } from '../live/trackPoint'
import { toGround, type Ground } from '../projection'
import { trackLine } from '../trackLine'
import { EMPTY_PROFILE, type TrackProfile } from '../trackProfile'
import { buildPolyline, projectForward, type Polyline } from './polyline'

/** A shape as the map draws it (network.ts ShapePath): its line's vertices, profile and band inputs. */
export interface DrawnShape {
  points: Polyline['points']
  profile: TrackProfile
  bandInputs: Float32Array
}

export interface ShapeGeometry extends DrawnTrack {
  shapeId: ShapeId
  line: Polyline
  stops: readonly StopId[]
  /** Distance along `line` of each stop; same length as `stops`, non-decreasing. */
  stopDistances: readonly number[]
  /** Largest distance from a stop to the track line; a sanity bound, not used in positioning. */
  maxStopOffsetM: number
  /** The map's vertical profile for this shape (EMPTY_PROFILE when flat): a train at d draws at profileAt(profile, d). */
  profile: TrackProfile
}

/**
 * Builds each pattern's line from the map's drawn shape (`drawn`, network.shapeById): the same vertices,
 * distances, profile and band inputs, so trains ride their direction's track and their route's band, up and down
 * its ramps. A shape the map doesn't draw (tests) falls back to `trackLine(shape, trackOffsetM)`, flat and
 * unbanded (at offset 0 it is still spur-dropped, not the raw shape). Then
 * projects the stops onto it, forward-only so distances never decrease (even on hairpins). Throws if
 * a pattern stop has no station or a pattern has no shape.
 */
export function buildShapeGeometries(
  shapes: ShapesFile,
  index: TripIndexFile,
  stations: StationsFile,
  trackOffsetM: number,
  drawn: ReadonlyMap<ShapeId, DrawnShape>,
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
    const map = drawn.get(shapeId)
    const line = buildPolyline(map ? map.points : trackLine(shape, trackOffsetM))
    const profile = map ? map.profile : EMPTY_PROFILE
    const zeros = line.points.map(() => 0)
    const bandInputs = map ? map.bandInputs : vertexBandInputs(line.points, zeros, zeros)
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
    out.set(shapeId, { shapeId, line, stops: pattern.stops, stopDistances, maxStopOffsetM, profile, bandInputs })
  }
  return out
}
