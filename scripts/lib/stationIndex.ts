/** public/data/stations/index.json: which stations have an interior, and whether it is authored or generated. Pure. */
import type { StationIndex, StationInterior } from '../../src/data/stationSchema.ts'

export const INDEX_FILE = 'index.json'
/** The files in public/data/stations/ that are not <id>.json interiors. */
export const NOT_INTERIOR_FILES: ReadonlySet<string> = new Set([INDEX_FILE])

/** Entries are inserted in id order, but a JS object lists integer-like keys ("101") first, numerically,
 *  so the written key order is not plain string order. Readers must not rely on it. */
export function buildStationIndex(interiors: readonly StationInterior[]): StationIndex {
  const sorted = [...interiors].sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0))
  const stations: StationIndex['stations'] = {}
  for (const i of sorted) {
    // The index shares the directory with the <id>.json files.
    if (NOT_INTERIOR_FILES.has(`${i.stationId}.json`)) throw new Error(`A station can not have the id "${i.stationId}": stations/${i.stationId}.json is not an interior`)
    if (Object.hasOwn(stations, i.stationId)) throw new Error(`Duplicate interior for station ${i.stationId}`)
    stations[i.stationId] = { provenance: i.generated ? 'generated' : 'authored' }
  }
  return { stations }
}
