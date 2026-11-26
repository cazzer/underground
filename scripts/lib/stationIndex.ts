/** public/data/stations/index.json: which stations have an interior, and whether it is authored or generated. Pure. */
import type { StationIndex, StationInterior } from '../../src/data/stationSchema.ts'
import { membersOf } from './stationMembers.ts'

export const INDEX_FILE = 'index.json'
/** The files in public/data/stations/ that are not <id>.json interiors. */
/** public/data/stations/equipment.json: the lazily loaded elevator and escalator index (scripts/lib/equipmentIndex.ts). */
export const EQUIPMENT_FILE = 'equipment.json'
/** public/data/stations/amenities.json: the on-demand restroom and customer service center list (scripts/lib/amenitiesIndex.ts). */
export const AMENITIES_FILE = 'amenities.json'
export const NOT_INTERIOR_FILES: ReadonlySet<string> = new Set([INDEX_FILE, EQUIPMENT_FILE, AMENITIES_FILE])

/** Entries are inserted in id order, but a JS object lists integer-like keys ("101") first, numerically,
 *  so the written key order is not plain string order. Readers must not rely on it.
 *  A complex's file is named after its first member; each other member is an alias entry naming that file. */
export function buildStationIndex(interiors: readonly StationInterior[]): StationIndex {
  const sorted = [...interiors].sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0))
  const entries = sorted.flatMap((i) => {
    // The index, the equipment file and the amenities file share the directory with the <id>.json files.
    if (NOT_INTERIOR_FILES.has(`${i.stationId}.json`)) throw new Error(`A station can not have the id "${i.stationId}": stations/${i.stationId}.json is not an interior`)
    const provenance = i.generated ? ('generated' as const) : ('authored' as const)
    return membersOf(i).map((id) => [id, id === i.stationId ? { provenance } : { provenance, file: i.stationId }] as const)
  })
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const stations: StationIndex['stations'] = {}
  for (const [id, entry] of entries) {
    if (Object.hasOwn(stations, id)) throw new Error(`Duplicate interior for station ${id}`)
    stations[id] = entry
  }
  return { stations }
}
