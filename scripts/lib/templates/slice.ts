/** One station's in-memory StationSources cut from the citywide catalog: the same shape a per-station fetch
 *  pins, so the merge and its row-claiming checks run unchanged. Generated sources are never written to disk. */
import type { Catalog } from '../catalogFacts.ts'
import type { CatalogStation } from '../catalogTypes.ts'
import type { EntranceRow, EquipmentRow, OsmWay, StationSources } from '../stationInputs.ts'

const SAME_POINT_DEG = 1e-6

/** Provenance headers of the catalog files the slice is cut from. */
export interface CatalogHeaders {
  osm: { fetchedAt: string; baseTimestamp: string; query: string }
  entrances: { url: string; rowsUpdatedAt: string }
  equipment: { url: string; rowsUpdatedAt: string }
}

export interface GeneratorCatalog extends Catalog {
  headers: CatalogHeaders
}

export interface Slice {
  sources: StationSources
  /** Rows left out, one line each (a duplicate entrance point would match two rows). */
  dropped: string[]
}

const byLatLon = (a: EntranceRow, b: EntranceRow): number => a.lat - b.lat || a.lon - b.lon

/** OSM platform ways by id, entrance rows that list the stop id (stripped to EntranceRow), and the station's
 *  revenue E&E rows. A machine without a position takes the station point: the template always replaces it. */
export function sliceSources(catalog: GeneratorCatalog, station: CatalogStation, wayIds: readonly number[]): Slice {
  const dropped: string[] = []
  const ways = wayIds.map((id): OsmWay => {
    const w = catalog.platforms.find((p) => p.id === id)
    if (!w) throw new Error(`platform way ${id} is not in the catalog`)
    return { id, tags: { ...w.tags }, ring: w.points.map(([lat, lon]): [number, number] => [lat, lon]) }
  })
  const entrances: EntranceRow[] = []
  for (const e of catalog.entrances.filter((r) => r.gtfsStopIds.includes(station.gtfsStopId))) {
    const row: EntranceRow = { type: e.type, entry: e.entry, exit: e.exit, lat: e.lat, lon: e.lon }
    if (entrances.some((r) => Math.abs(r.lat - row.lat) <= SAME_POINT_DEG && Math.abs(r.lon - row.lon) <= SAME_POINT_DEG)) {
      dropped.push(`entrance row ${row.lat},${row.lon} (${row.type}): same point as another row`)
      continue
    }
    entrances.push(row)
  }
  const equipment: EquipmentRow[] = []
  for (const e of catalog.equipment.filter((r) => r.revenue && r.stationId === station.stationId)) {
    if (e.serving === null || e.serving.trim() === '') {
      dropped.push(`${e.code}: no serving text`)
      continue
    }
    equipment.push({ code: e.code, kind: e.kind, lat: e.lat ?? station.lat, lon: e.lon ?? station.lon, serving: e.serving })
  }
  const h = catalog.headers
  return {
    sources: {
      stationId: station.gtfsStopId,
      fetchedAt: h.osm.fetchedAt,
      osm: { license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', query: h.osm.query, baseTimestamp: h.osm.baseTimestamp, ways },
      entrances: { dataset: 'i9wp-a4ja', url: h.entrances.url, rowsUpdatedAt: h.entrances.rowsUpdatedAt, rows: entrances.sort(byLatLon) },
      equipment: {
        dataset: '94fv-bak7',
        url: h.equipment.url,
        rowsUpdatedAt: h.equipment.rowsUpdatedAt,
        rows: equipment.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
      },
    },
    dropped,
  }
}
