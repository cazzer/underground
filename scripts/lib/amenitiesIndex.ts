/** public/data/stations/amenities.json: the stations with a public restroom or a customer service center, each
 *  complex member under its own id. Pure; build-stations.ts is the IO.
 *  Licensing: MTA data under the OPEN-NY Terms of Use (the restroom list) and the MTA's public Customer Service
 *  Centers page (hand-copied); no OSM content. */
import { AMENITIES_FORMAT, type AmenitiesFile, type StationAmenities } from '../../src/data/amenitiesSchema.ts'
import type { CatalogAmenity, CatalogStation } from './catalogTypes.ts'
import type { CustomerServiceCenters } from './customerServiceCenters.ts'

export const AMENITIES_ATTRIBUTION =
  'Metropolitan Transportation Authority. MTA Subway Station Amenities (data.ny.gov 6yjv-fk7g) and MTA Subway Stations (39hk-dx4f), under the OPEN-NY Terms of Use; Customer Service Centers from mta.info/contact-us/customer-service-centers (retrieved {date}).'

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export interface AmenitiesIndexBuild {
  file: AmenitiesFile
  /** What was left out and why, one line each. */
  log: string[]
}

/**
 * Restroom rows and customer service centers, each expanded to the GTFS stops of its station's complex that `gtfsIds`
 * (stations.json) knows, so every member of a complex has the same entry. A restroom row names a catalog MRN (one MRN
 * can cover several GTFS stops); a center names one GTFS stop, not necessarily the lead. Throws for a row or center at a
 * station the catalog lacks, a repeated restroom id, rows from more than one month, no rows at all, and two centers in
 * one complex; logs and skips a row or center whose complex the map doesn't have.
 */
export function buildAmenitiesIndex(
  stations: readonly CatalogStation[],
  restrooms: { rows: readonly CatalogAmenity[]; rowsUpdatedAt: string },
  centers: CustomerServiceCenters,
  gtfsIds: ReadonlySet<string>,
): AmenitiesIndexBuild {
  const log: string[] = []
  const complexOfMrn = new Map<string, string>()
  const complexOfStop = new Map<string, string>()
  const membersOfComplex = new Map<string, string[]>()
  for (const s of stations) {
    complexOfMrn.set(s.stationId, s.complexId)
    complexOfStop.set(s.gtfsStopId, s.complexId)
    if (!gtfsIds.has(s.gtfsStopId)) continue
    const members = membersOfComplex.get(s.complexId) ?? []
    members.push(s.gtfsStopId)
    membersOfComplex.set(s.complexId, members)
  }

  if (restrooms.rows.length === 0) throw new Error('amenities: the restroom list has no rows')
  const months = new Set(restrooms.rows.map((r) => r.month))
  if (months.size !== 1) throw new Error(`amenities: restroom rows come from ${months.size} months (${[...months].sort().join(', ')}), expected one`)
  const restroomsMonth = [...months][0] ?? ''

  const restroomsIn = new Map<string, number>()
  const seen = new Set<string>()
  for (const row of restrooms.rows) {
    if (seen.has(row.id)) throw new Error(`amenities: restroom ${row.id} appears twice`)
    seen.add(row.id)
    const complexId = complexOfMrn.get(row.stationId)
    if (complexId === undefined) throw new Error(`amenities: restroom ${row.id}: station ${row.stationId} is not in the station catalog`)
    restroomsIn.set(complexId, (restroomsIn.get(complexId) ?? 0) + 1)
  }

  const cscIn = new Map<string, { entrance: string; stopId: string }>()
  for (const c of centers.centers) {
    const complexId = complexOfStop.get(c.gtfsStopId)
    if (complexId === undefined) throw new Error(`amenities: customer service center at ${c.gtfsStopId} (${c.name}) is not in the station catalog`)
    const earlier = cscIn.get(complexId)
    if (earlier !== undefined) throw new Error(`amenities: customer service centers at ${earlier.stopId} and ${c.gtfsStopId} are in one complex`)
    cscIn.set(complexId, { entrance: c.entrance, stopId: c.gtfsStopId })
  }

  const entries = new Map<string, StationAmenities>()
  const place = (complexId: string, what: string, amenities: StationAmenities): void => {
    const members = membersOfComplex.get(complexId) ?? []
    if (members.length === 0) {
      log.push(`${what}: no station of complex ${complexId} is in stations.json, skipped`)
      return
    }
    for (const member of members) entries.set(member, { ...entries.get(member), ...amenities })
  }
  for (const [complexId, count] of restroomsIn) place(complexId, `${count} restroom(s)`, { restrooms: count })
  for (const [complexId, c] of cscIn) place(complexId, `customer service center at ${c.stopId}`, { csc: { entrance: c.entrance } })

  const file: AmenitiesFile = {
    format: AMENITIES_FORMAT,
    attribution: AMENITIES_ATTRIBUTION.replace('{date}', centers.retrievedAt),
    restroomsUpdatedAt: restrooms.rowsUpdatedAt,
    restroomsMonth,
    cscRetrievedAt: centers.retrievedAt,
    stations: Object.fromEntries([...entries].sort(([a], [b]) => byText(a, b))),
  }
  return { file, log }
}
