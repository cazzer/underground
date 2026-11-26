import { describe, expect, it } from 'vitest'
import type { CatalogAmenity, CatalogStation } from './catalogTypes.ts'
import type { CustomerServiceCenter } from './customerServiceCenters.ts'
import { buildAmenitiesIndex } from './amenitiesIndex.ts'

const station = (gtfsStopId: string, stationId: string, complexId: string): CatalogStation => ({
  gtfsStopId,
  stationId,
  complexId,
  division: 'IND',
  line: 'x',
  name: gtfsStopId,
  borough: 'M',
  routes: [],
  structure: 'Subway',
  lat: 40.7,
  lon: -74,
  ada: 1,
  adaNorth: true,
  adaSouth: true,
  adaNotes: null,
  northLabel: 'N',
  southLabel: 'S',
})

const restroom = (id: string, stationId: string, month = '2026-10-01'): CatalogAmenity => ({ id, type: 'PUBLIC_RESTROOM', stationId, month })
const center = (gtfsStopId: string, entrance = `Enter at ${gtfsStopId}`): CustomerServiceCenter => ({ gtfsStopId, name: gtfsStopId, pageName: gtfsStopId, entrance })

// A01 and B01 are two stations (MRNs 1 and 2) of complex C1; D01 and D02 share MRN 3 (complex C3); E01 is alone; F01's
// complex is not in stations.json.
const STATIONS = [
  station('A01', '1', 'C1'),
  station('B01', '2', 'C1'),
  station('D01', '3', 'C3'),
  station('D02', '3', 'C3'),
  station('E01', '4', 'C4'),
  station('F01', '5', 'C5'),
]
const KNOWN = new Set(['A01', 'B01', 'D01', 'D02', 'E01'])
const build = (rows: CatalogAmenity[], centers: CustomerServiceCenter[] = [center('E01')], known: ReadonlySet<string> = KNOWN) =>
  buildAmenitiesIndex(STATIONS, { rows, rowsUpdatedAt: '2026-11-01T00:00:00.000Z' }, { source: 's', retrievedAt: '2026-11-26', about: 'a', centers }, known)

describe('buildAmenitiesIndex', () => {
  it('counts restrooms per complex and gives every member the same entry', () => {
    const { file } = build([restroom('r1', '1'), restroom('r2', '2'), restroom('r3', '2'), restroom('r4', '4')], [])
    expect(file.stations).toEqual({ A01: { restrooms: 3 }, B01: { restrooms: 3 }, E01: { restrooms: 1 } })
  })

  it('expands one MRN to every GTFS stop it covers', () => {
    expect(build([restroom('r1', '3')], []).file.stations).toEqual({ D01: { restrooms: 1 }, D02: { restrooms: 1 } })
  })

  it('expands a center through its complex, whichever member it names, and merges it with the restrooms', () => {
    const { file } = build([restroom('r1', '1')], [center('B01', 'Enter at 2 St')])
    expect(file.stations).toEqual({ A01: { restrooms: 1, csc: { entrance: 'Enter at 2 St' } }, B01: { restrooms: 1, csc: { entrance: 'Enter at 2 St' } } })
  })

  it('carries the sources and dates and no build time', () => {
    const { file } = build([restroom('r1', '4')])
    expect(file).toMatchObject({ format: 1, restroomsUpdatedAt: '2026-11-01T00:00:00.000Z', restroomsMonth: '2026-10-01', cscRetrievedAt: '2026-11-26' })
    expect(file.attribution).toMatch(/6yjv-fk7g.*OPEN-NY.*2026-11-26/)
  })

  it('writes its stations in sorted order', () => {
    expect(Object.keys(build([restroom('r1', '4'), restroom('r2', '3')], [center('A01')]).file.stations)).toEqual(['A01', 'B01', 'D01', 'D02', 'E01'])
  })

  it('logs and skips a complex stations.json lacks', () => {
    const { file, log } = build([restroom('r1', '5'), restroom('r2', '4')], [])
    expect(Object.keys(file.stations)).toEqual(['E01'])
    expect(log).toHaveLength(1)
    expect(log[0]).toMatch(/C5/)
  })

  it('throws for a restroom at a station the catalog lacks', () => {
    expect(() => build([restroom('r1', '99')])).toThrow(/restroom r1: station 99 is not in the station catalog/)
  })

  it('throws for a center at a stop the catalog lacks', () => {
    expect(() => build([restroom('r1', '4')], [center('Z99')])).toThrow(/Z99.*not in the station catalog/)
  })

  it('throws for a repeated restroom id, mixed months, no rows, and two centers in one complex', () => {
    expect(() => build([restroom('r1', '1'), restroom('r1', '2')])).toThrow(/appears twice/)
    expect(() => build([restroom('r1', '1'), restroom('r2', '2', '2026-09-01')])).toThrow(/2 months/)
    expect(() => build([])).toThrow(/no rows/)
    expect(() => build([restroom('r1', '1')], [center('A01'), center('B01')])).toThrow(/one complex/)
  })
})
