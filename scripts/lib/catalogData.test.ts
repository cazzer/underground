/** Reads the committed data/stations/catalog/ files: they must agree with themselves and with each other. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MIN_ENVELOPES } from './catalogEnvelopes.ts'
import { stationsWithoutWay } from './catalogOsm.ts'
import type { CatalogAmenity, CatalogEntrance, CatalogEnvelope, CatalogEquipment, CatalogStation, OsmCatalogWay, SodaHeader } from './catalogTypes.ts'

function load<T extends object>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../data/stations/catalog/${name}.json`, import.meta.url), 'utf8')) as T
}

const stations = load<SodaHeader & { rows: CatalogStation[] }>('stations')
const entrances = load<SodaHeader & { rows: CatalogEntrance[] }>('entrances')
const equipment = load<SodaHeader & { rows: CatalogEquipment[] }>('equipment')
const amenities = load<SodaHeader & { rows: CatalogAmenity[] }>('amenities')
const envelopes = load<SodaHeader & { kept: number; rows: CatalogEnvelope[] }>('envelopes')
interface OsmFile {
  baseTimestamp: string
  platformRadiusM: number
  trackRadiusM: number
  ways: OsmCatalogWay[]
}
const platforms = load<OsmFile & { skippedRelations: number[] }>('osm-platforms')
const tracks = load<OsmFile>('osm-tracks')

describe('the pinned catalog', () => {
  it('holds exactly the rows its headers counted', () => {
    expect(stations.rows).toHaveLength(stations.count)
    expect(entrances.rows).toHaveLength(entrances.count)
    expect(equipment.rows).toHaveLength(equipment.count)
    expect(amenities.rows).toHaveLength(amenities.count)
    expect(envelopes.rows).toHaveLength(envelopes.kept)
    expect(envelopes.kept).toBeLessThanOrEqual(envelopes.count)
    expect(envelopes.kept).toBeGreaterThanOrEqual(MIN_ENVELOPES)
  })
  it('records its provenance', () => {
    for (const h of [stations, entrances, equipment, amenities, envelopes]) {
      expect(h.attribution).toBe('Metropolitan Transportation Authority')
      expect(h.terms).toMatch(/OPEN-NY/)
      expect(Date.parse(h.rowsUpdatedAt)).not.toBeNaN()
      expect(Date.parse(h.fetchedAt)).not.toBeNaN()
    }
    for (const o of [platforms, tracks]) expect(Date.parse(o.baseTimestamp)).not.toBeNaN()
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
  it('ties every amenity to a station in the station list, in one month', () => {
    const stationIds = new Set(stations.rows.map((s) => s.stationId))
    for (const a of amenities.rows) expect(stationIds.has(a.stationId), `amenity ${a.id} station ${a.stationId}`).toBe(true)
    expect(new Set(amenities.rows.map((a) => a.month)).size).toBe(1)
    expect(amenities.url).toContain(amenities.rows[0]!.month)
    expect(amenities.url).toContain('PUBLIC_RESTROOM')
  })
  it('has unique keys', () => {
    expect(new Set(amenities.rows.map((a) => a.id)).size).toBe(amenities.rows.length)
    expect(new Set(stations.rows.map((s) => s.gtfsStopId)).size).toBe(stations.rows.length)
    expect(new Set(equipment.rows.map((e) => e.code)).size).toBe(equipment.rows.length)
    const ways = [...platforms.ways, ...tracks.ways]
    expect(new Set(ways.map((w) => w.id)).size).toBe(ways.length)
  })
  it('has a platform way within range of every station (a timed-out fetch would not)', () => {
    const bare = stationsWithoutWay(stations.rows, platforms.ways, platforms.platformRadiusM)
    expect(bare.map((s) => `${s.gtfsStopId} ${s.name}`)).toEqual([])
  })
  it('has a track way within range of every station', () => {
    const bare = stationsWithoutWay(stations.rows, tracks.ways, tracks.trackRadiusM)
    expect(bare.map((s) => `${s.gtfsStopId} ${s.name}`)).toEqual([])
  })
  it('keeps platforms and tracks apart', () => {
    expect(platforms.ways.every((w) => w.tags.railway === 'platform')).toBe(true)
    expect(tracks.ways.every((w) => w.tags.railway === 'subway')).toBe(true)
  })
})
