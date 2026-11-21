/** Reads the committed data/stations/catalog/ files: they must agree with themselves and with each other. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CatalogEntrance, CatalogEnvelope, CatalogEquipment, CatalogStation, OsmCatalogWay, SodaHeader } from './catalogTypes.ts'

function load<T extends object>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../data/stations/catalog/${name}.json`, import.meta.url), 'utf8')) as T
}

const stations = load<SodaHeader & { rows: CatalogStation[] }>('stations')
const entrances = load<SodaHeader & { rows: CatalogEntrance[] }>('entrances')
const equipment = load<SodaHeader & { rows: CatalogEquipment[] }>('equipment')
const envelopes = load<SodaHeader & { kept: number; rows: CatalogEnvelope[] }>('envelopes')
const osm = load<{ baseTimestamp: string; ways: OsmCatalogWay[]; skippedRelations: number[] }>('osm')

describe('the pinned catalog', () => {
  it('holds exactly the rows its headers counted', () => {
    expect(stations.rows).toHaveLength(stations.count)
    expect(entrances.rows).toHaveLength(entrances.count)
    expect(equipment.rows).toHaveLength(equipment.count)
    expect(envelopes.rows).toHaveLength(envelopes.kept)
    expect(envelopes.kept).toBeLessThanOrEqual(envelopes.count)
  })
  it('records its provenance', () => {
    for (const h of [stations, entrances, equipment, envelopes]) {
      expect(h.attribution).toBe('Metropolitan Transportation Authority')
      expect(h.terms).toMatch(/OPEN-NY/)
      expect(Date.parse(h.rowsUpdatedAt)).not.toBeNaN()
      expect(Date.parse(h.fetchedAt)).not.toBeNaN()
    }
    expect(Date.parse(osm.baseTimestamp)).not.toBeNaN()
  })
  it('ties every entrance to a station and a stop in the station list', () => {
    const stopIds = new Set(stations.rows.map((s) => s.gtfsStopId))
    const stationIds = new Set(stations.rows.map((s) => s.stationId))
    for (const e of entrances.rows) {
      expect(stationIds.has(e.stationId), `entrance station ${e.stationId}`).toBe(true)
      for (const id of e.gtfsStopIds) expect(stopIds.has(id), `entrance stop ${id}`).toBe(true)
    }
  })
  it('ties every equipment row that names a station to one in the station list', () => {
    const stationIds = new Set(stations.rows.map((s) => s.stationId))
    for (const e of equipment.rows) {
      if (e.stationId !== null) expect(stationIds.has(e.stationId), `${e.code} station ${e.stationId}`).toBe(true)
    }
  })
  it('has unique keys', () => {
    expect(new Set(stations.rows.map((s) => s.gtfsStopId)).size).toBe(stations.rows.length)
    expect(new Set(equipment.rows.map((e) => e.code)).size).toBe(equipment.rows.length)
    expect(new Set(osm.ways.map((w) => w.id)).size).toBe(osm.ways.length)
  })
})
