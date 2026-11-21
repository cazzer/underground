import { buildShapeGeometries } from '../lib/realtime/shapeGeometry'
import { buildTripLookup } from '../lib/realtime/tripLookup'
import type { StaticRealtimeData } from '../lib/realtime/prepareTrips'
import type { TrackProfile } from '../lib/trackProfile'
import { expectDataRecord, fetchJson, type NetworkFiles } from './loadNetwork'
import type { SegmentsFile, ShapeId, TripIndexFile } from './schema'

/**
 * Fetches trip-index and segments (only needed for live trains) and builds what `prepareTrips`
 * joins against, with trip lines `trackOffsetM` right of travel and on the vertical `profiles` like the map's
 * (`network.trackOffsetM`, `network.profiles`). Throws when they come from a different build than the stations already loaded.
 */
export async function loadRealtimeStatic(
  baseUrl: string,
  files: NetworkFiles,
  trackOffsetM: number,
  profiles: ReadonlyMap<ShapeId, TrackProfile>,
  signal: AbortSignal,
): Promise<StaticRealtimeData> {
  const [index, segments] = await Promise.all([
    fetchJson(`${baseUrl}data/trip-index.json`, signal).then((raw) =>
      expectDataRecord<TripIndexFile>(raw, 'patterns', `${baseUrl}data/trip-index.json`),
    ),
    fetchJson(`${baseUrl}data/segments.json`, signal).then((raw) =>
      expectDataRecord<SegmentsFile>(raw, 'segments', `${baseUrl}data/segments.json`),
    ),
  ])
  if (segments.feedVersion !== files.stations.feedVersion) {
    throw new Error(`feedVersion mismatch: segments ${segments.feedVersion} vs stations ${files.stations.feedVersion}`)
  }
  return {
    lookup: buildTripLookup(index, files.shapes),
    geometries: buildShapeGeometries(files.shapes, index, files.stations, trackOffsetM, profiles),
    segments: segments.segments,
  }
}
