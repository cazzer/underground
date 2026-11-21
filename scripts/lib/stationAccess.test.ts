import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../src/data/schema.ts'
import type { CatalogStation, SodaHeader } from './catalogTypes.ts'
import type { GtfsStation } from './network.ts'
import { addAccess } from './stationAccess.ts'
import { toStableJson } from './stableJson.ts'

const gtfs = (id: string): GtfsStation => ({ id, name: id, lat: 40.7, lon: -74, stops: [`${id}N`, `${id}S`], routes: ['1'] })

const row = (id: string, over: Partial<CatalogStation> = {}): CatalogStation => ({
  gtfsStopId: id,
  stationId: id,
  complexId: id,
  division: 'IRT',
  line: 'Line',
  name: id,
  borough: 'M',
  routes: ['1'],
  structure: 'Subway',
  lat: 40.7,
  lon: -74,
  ada: 1,
  adaNorth: true,
  adaSouth: true,
  adaNotes: null,
  northLabel: 'Uptown',
  southLabel: 'Downtown',
  ...over,
})

const none = { ada: 0, adaNorth: false, adaSouth: false }
const partial = { ada: 2, adaNorth: false, adaSouth: true, adaNotes: 'Downtown only' }

describe('addAccess', () => {
  it('encodes none, full and partial', () => {
    const out = addAccess([gtfs('A'), gtfs('B'), gtfs('C')], [row('A', none), row('B'), row('C', { ...partial, borough: 'Bk' })])
    expect(out.map((s) => [s.borough, s.ada])).toEqual([
      ['M', 'none'],
      ['M', 'full'],
      ['Bk', 'partial'],
    ])
    expect(out[2]!.adaPartial).toEqual({ north: false, south: true, note: 'Downtown only' })
  })

  it('writes adaPartial only on partial stations', () => {
    const out = addAccess([gtfs('A'), gtfs('B')], [row('A', none), row('B')])
    for (const s of out) expect('adaPartial' in s).toBe(false)
  })

  it('keeps input order and puts the new keys after routes', () => {
    const out = addAccess([gtfs('B'), gtfs('A')], [row('A'), row('B', partial)])
    expect(out.map((s) => s.id)).toEqual(['B', 'A'])
    expect(Object.keys(out[0]!)).toEqual(['id', 'name', 'lat', 'lon', 'stops', 'routes', 'borough', 'ada', 'adaPartial'])
    expect(Object.keys(out[1]!).slice(-2)).toEqual(['borough', 'ada'])
  })

  it('names every GTFS station without a catalog row and every orphan row at once', () => {
    const run = () => addAccess([gtfs('A'), gtfs('B'), gtfs('C')], [row('A'), row('X'), row('Y')])
    expect(run).toThrow(/no catalog row: B, C \(run npm run data:catalog:fetch\)/)
    expect(run).toThrow(/no GTFS station: X, Y/)
  })

  it('rejects an unknown borough or ada code, naming the station', () => {
    expect(() => addAccess([gtfs('A')], [row('A', { borough: 'B' })])).toThrow(/A: unknown borough "B"/)
    expect(() => addAccess([gtfs('A')], [row('A', { ada: 3 })])).toThrow(/A: ada 3/)
  })

  it('rejects ada 0 with a flag or a note', () => {
    expect(() => addAccess([gtfs('A')], [row('A', { ...none, adaNorth: true })])).toThrow(/A: ada 0/)
    expect(() => addAccess([gtfs('A')], [row('A', { ...none, adaNotes: 'x' })])).toThrow(/A: ada 0/)
  })

  it('rejects ada 1 with a false flag or a note', () => {
    expect(() => addAccess([gtfs('A')], [row('A', { adaSouth: false })])).toThrow(/A: ada 1/)
    expect(() => addAccess([gtfs('A')], [row('A', { adaNotes: 'x' })])).toThrow(/A: ada 1/)
  })

  it('rejects ada 2 without a note or without exactly one direction', () => {
    expect(() => addAccess([gtfs('A')], [row('A', { ...partial, adaNotes: null })])).toThrow(/A: ada 2/)
    expect(() => addAccess([gtfs('A')], [row('A', { ...partial, adaNotes: '  ' })])).toThrow(/A: ada 2/)
    expect(() => addAccess([gtfs('A')], [row('A', { ...partial, adaNorth: true })])).toThrow(/A: ada 2/)
    expect(() => addAccess([gtfs('A')], [row('A', { ...partial, adaSouth: false })])).toThrow(/A: ada 2/)
  })

  it('lists every bad station in one error', () => {
    const run = () => addAccess([gtfs('A'), gtfs('B')], [row('A', { borough: 'Z' }), row('B', { ada: 9 })])
    expect(run).toThrow(/A: unknown borough[\s\S]*B: ada 9/)
  })
})

describe('the committed stations.json', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
  const stationsText = read('../../public/data/stations.json')
  const file = JSON.parse(stationsText) as StationsFile
  const catalog = JSON.parse(read('../../data/stations/catalog/stations.json')) as SodaHeader & { rows: CatalogStation[] }

  it('gives every station a borough and ada status', () => {
    for (const s of file.stations) {
      expect(s.borough, s.id).toBeTruthy()
      expect(s.ada, s.id).toBeTruthy()
    }
  })

  it('is what addAccess makes from the catalog (rerun npm run data if this fails)', () => {
    const bare = file.stations.map(({ borough: _b, ada: _a, adaPartial: _p, ...rest }) => rest)
    const rebuilt = { ...file, stations: addAccess(bare, catalog.rows) }
    expect(toStableJson(rebuilt, 2)).toBe(stationsText)
  })
})
