/** The generator's inputs from the parsed catalog files (data/stations/catalog/) and the committed public/data
 *  shapes and stations. Pure: callers read the files. The files are pinned and checked elsewhere
 *  (catalogData.test.ts, build-data), so only their outer shape is assumed here. */
import type { ShapesFile, StationsFile } from '../../src/data/schema.ts'
import type { CatalogEntrance, CatalogEquipment, CatalogStation, OsmCatalogWay } from './catalogTypes.ts'
import type { GeneratorCatalog } from './templates/slice.ts'
import { mapTrackLines } from './templates/tracks.ts'
import type { MapTrackLines } from './templates/tracks.ts'

export const CATALOG_FILES = ['stations.json', 'entrances.json', 'equipment.json', 'osm-platforms.json', 'osm-tracks.json'] as const
export type CatalogFileName = (typeof CATALOG_FILES)[number]

interface SodaFile<T> {
  url: string
  rowsUpdatedAt: string
  rows: T[]
}
interface OsmFile {
  fetchedAt: string
  baseTimestamp: string
  query: string
  ways: OsmCatalogWay[]
}

export function generatorCatalog(files: Record<CatalogFileName, unknown>): GeneratorCatalog {
  const stations = files['stations.json'] as SodaFile<CatalogStation>
  const entrances = files['entrances.json'] as SodaFile<CatalogEntrance>
  const equipment = files['equipment.json'] as SodaFile<CatalogEquipment>
  const platforms = files['osm-platforms.json'] as OsmFile
  const tracks = files['osm-tracks.json'] as OsmFile
  return {
    stations: stations.rows,
    entrances: entrances.rows,
    equipment: equipment.rows,
    platforms: platforms.ways,
    tracks: tracks.ways,
    headers: {
      osm: { fetchedAt: platforms.fetchedAt, baseTimestamp: platforms.baseTimestamp, query: platforms.query },
      entrances: { url: entrances.url, rowsUpdatedAt: entrances.rowsUpdatedAt },
      equipment: { url: equipment.url, rowsUpdatedAt: equipment.rowsUpdatedAt },
    },
  }
}

export function generatorLines(shapes: unknown, stations: unknown): MapTrackLines {
  return mapTrackLines((shapes as ShapesFile).shapes, (stations as StationsFile).stations)
}
