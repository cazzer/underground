import { buildShapeGeometries } from '../lib/realtime/shapeGeometry'
import { buildTripLookup } from '../lib/realtime/tripLookup'
import type { StaticRealtimeData } from '../lib/realtime/prepareTrips'
import type { DrawnShape } from '../lib/realtime/shapeGeometry'

/** The map's drawn shapes, once their bands are in (useNetwork's `bands`). */
export type DrawnShapes = PromiseLike<{ shapeById: ReadonlyMap<ShapeId, DrawnShape> }>
import { expectDataRecord, fetchJson, type NetworkFiles } from './loadNetwork'
import type { SegmentsFile, ShapeId, TripIndexFile } from './schema'

/**
 * Fetches trip-index and segments (only needed for live trains) and builds what `prepareTrips`
 * joins against, with trip lines the map's own (`drawn`, awaited alongside the fetches, so trains ride the bands
 * the lines draw; `trackOffsetM` only for a shape it doesn't draw). Throws when they come from a different build
 * than the stations already loaded.
 */
export async function loadRealtimeStatic(
  baseUrl: string,
  files: NetworkFiles,
  trackOffsetM: number,
  drawn: DrawnShapes,
  signal: AbortSignal,
): Promise<StaticRealtimeData> {
  const [index, segments, { shapeById }] = await Promise.all([
    fetchJson(`${baseUrl}data/trip-index.json`, signal).then((raw) =>
      expectDataRecord<TripIndexFile>(raw, 'patterns', `${baseUrl}data/trip-index.json`),
    ),
    fetchJson(`${baseUrl}data/segments.json`, signal).then((raw) =>
      expectDataRecord<SegmentsFile>(raw, 'segments', `${baseUrl}data/segments.json`),
    ),
    drawn,
  ])
  if (segments.feedVersion !== files.stations.feedVersion) {
    throw new Error(`feedVersion mismatch: segments ${segments.feedVersion} vs stations ${files.stations.feedVersion}`)
  }
  return {
    lookup: buildTripLookup(index, files.shapes),
    geometries: buildShapeGeometries(files.shapes, index, files.stations, trackOffsetM, shapeById),
    segments: segments.segments,
  }
}
