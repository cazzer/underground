/** public/data/stations/index.json: which stations have an interior, and whether it is authored or generated. Pure. */
import type { StationIndex, StationInterior } from '../../src/data/stationSchema.ts'

export function buildStationIndex(interiors: readonly StationInterior[]): StationIndex {
  const sorted = [...interiors].sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0))
  const stations: StationIndex['stations'] = {}
  for (const i of sorted) {
    // `index.json` shares the directory with the <id>.json files.
    if (i.stationId === 'index') throw new Error('A station can not have the id "index": stations/index.json is the index')
    if (Object.hasOwn(stations, i.stationId)) throw new Error(`Duplicate interior for station ${i.stationId}`)
    stations[i.stationId] = { provenance: i.generated ? 'generated' : 'authored' }
  }
  return { stations }
}
