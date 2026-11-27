/** The committed public/data/stations/amenities.json: fresh against the pinned catalog, the centers list and stations.json, inside its own cap, and consistent. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AmenitiesFile } from '../../src/data/amenitiesSchema.ts'
import type { StationsFile } from '../../src/data/schema.ts'
import { buildAmenitiesIndex } from './amenitiesIndex.ts'
import { AMENITIES_GZIP_CAP_BYTES, checkAmenitiesCap, renderedFile } from './budget.ts'
import type { CatalogAmenity, CatalogStation, SodaHeader } from './catalogTypes.ts'
import { parseCustomerServiceCenters } from './customerServiceCenters.ts'
import { toStableJson } from './stableJson.ts'
import { AMENITIES_FILE } from './stationIndex.ts'

const text = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const catalog = <T>(name: string): SodaHeader & { rows: T[] } => JSON.parse(text(`../../data/stations/catalog/${name}.json`)) as SodaHeader & { rows: T[] }
const committedText = text(`../../public/data/stations/${AMENITIES_FILE}`)
const committed = JSON.parse(committedText) as AmenitiesFile
const stationsFile = JSON.parse(text('../../public/data/stations.json')) as StationsFile
const knownStations = new Set(stationsFile.stations.map((s) => s.id))
const catalogStations = catalog<CatalogStation>('stations').rows
const restrooms = catalog<CatalogAmenity>('amenities')
const centers = parseCustomerServiceCenters(JSON.parse(text('../../data/stations/customer-service-centers.json')))

describe('stations/amenities.json', () => {
  it('is fresh: rebuilding from the pinned catalog, the centers list and stations.json reproduces it byte for byte', () => {
    const { file } = buildAmenitiesIndex(catalogStations, restrooms, centers, knownStations)
    expect(toStableJson(file, 2)).toBe(committedText)
  })

  it('fits its own gzip cap', () => {
    expect(checkAmenitiesCap(renderedFile(AMENITIES_FILE, committedText))).toBeLessThanOrEqual(AMENITIES_GZIP_CAP_BYTES)
  })

  it('keys only stations stations.json has, each with an amenity', () => {
    for (const [id, a] of Object.entries(committed.stations)) {
      expect(knownStations.has(id), id).toBe(true)
      expect(a.restrooms !== undefined || a.csc !== undefined, id).toBe(true)
      if (a.restrooms !== undefined) expect(a.restrooms, id).toBeGreaterThan(0)
    }
  })

  it('lists every restroom station and every center, and every member of a complex alike', () => {
    for (const row of restrooms.rows) {
      for (const s of catalogStations.filter((c) => c.stationId === row.stationId && knownStations.has(c.gtfsStopId))) {
        expect(committed.stations[s.gtfsStopId]?.restrooms, `${row.id} at ${s.gtfsStopId}`).toBeGreaterThan(0)
      }
    }
    const complexOf = new Map(catalogStations.map((s) => [s.gtfsStopId, s.complexId]))
    for (const c of centers.centers) {
      const complexId = complexOf.get(c.gtfsStopId)
      for (const s of catalogStations.filter((m) => m.complexId === complexId && knownStations.has(m.gtfsStopId))) {
        expect(committed.stations[s.gtfsStopId]?.csc, `${c.gtfsStopId} at ${s.gtfsStopId}`).toEqual({ entrance: c.entrance })
      }
    }
  })
})
