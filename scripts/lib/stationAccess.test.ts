import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../src/data/schema.ts'
import type { CatalogStation, SodaHeader } from './catalogTypes.ts'
import type { GtfsStation } from './network.ts'
import { parseAccessExceptions, type AccessExceptions } from './accessExceptions.ts'
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

const noExceptions: AccessExceptions = { missing: {}, orphans: {} }
const exceptions = (over: Partial<AccessExceptions>): AccessExceptions => ({ ...noExceptions, ...over })
const add = (stations: GtfsStation[], rows: CatalogStation[], e: AccessExceptions = noExceptions) => addAccess(stations, rows, e).stations

const none = { ada: 0, adaNorth: false, adaSouth: false }
const partial = { ada: 2, adaNorth: false, adaSouth: true, adaNotes: 'Downtown only' }

describe('addAccess', () => {
  it('encodes none, full and partial', () => {
    const out = add([gtfs('A'), gtfs('B'), gtfs('C')], [row('A', none), row('B'), row('C', { ...partial, borough: 'Bk' })])
    expect(out.map((s) => [s.borough, s.ada])).toEqual([
      ['M', 'none'],
      ['M', 'full'],
      ['Bk', 'partial'],
    ])
    expect(out[2]!.adaPartial).toEqual({ north: false, south: true, note: 'Downtown only' })
  })

  it('writes adaPartial only on partial stations', () => {
    const out = add([gtfs('A'), gtfs('B')], [row('A', none), row('B')])
    for (const s of out) expect('adaPartial' in s).toBe(false)
  })

  it('keeps input order and puts the new keys after routes', () => {
    const out = add([gtfs('B'), gtfs('A')], [row('A'), row('B', partial)])
    expect(out.map((s) => s.id)).toEqual(['B', 'A'])
    expect(Object.keys(out[0]!)).toEqual(['id', 'name', 'lat', 'lon', 'stops', 'routes', 'borough', 'ada', 'adaPartial'])
    expect(Object.keys(out[1]!).slice(-2)).toEqual(['borough', 'ada'])
  })

  it('names every GTFS station without a catalog row and every orphan row at once', () => {
    const run = () => add([gtfs('A'), gtfs('B'), gtfs('C')], [row('A'), row('X'), row('Y')])
    expect(run).toThrow(/no catalog row: B, C \(run npm run data:catalog:fetch; if 39hk-dx4f doesn.t list it yet, add it to data\/stations\/access-exceptions\.json\)/)
    expect(run).toThrow(/no GTFS station: X, Y/)
  })

  it('rejects an unknown borough or ada code, naming the station', () => {
    expect(() => add([gtfs('A')], [row('A', { borough: 'B' })])).toThrow(/A: unknown borough "B"/)
    expect(() => add([gtfs('A')], [row('A', { ada: 3 })])).toThrow(/A: ada 3/)
  })

  it('rejects ada 0 with a flag or a note', () => {
    expect(() => add([gtfs('A')], [row('A', { ...none, adaNorth: true })])).toThrow(/A: ada 0/)
    expect(() => add([gtfs('A')], [row('A', { ...none, adaNotes: 'x' })])).toThrow(/A: ada 0/)
  })

  it('rejects ada 1 with a false flag or a note', () => {
    expect(() => add([gtfs('A')], [row('A', { adaSouth: false })])).toThrow(/A: ada 1/)
    expect(() => add([gtfs('A')], [row('A', { adaNotes: 'x' })])).toThrow(/A: ada 1/)
  })

  it('rejects ada 2 without a note or without exactly one direction', () => {
    expect(() => add([gtfs('A')], [row('A', { ...partial, adaNotes: null })])).toThrow(/A: ada 2/)
    expect(() => add([gtfs('A')], [row('A', { ...partial, adaNotes: '  ' })])).toThrow(/A: ada 2/)
    expect(() => add([gtfs('A')], [row('A', { ...partial, adaNorth: true })])).toThrow(/A: ada 2/)
    expect(() => add([gtfs('A')], [row('A', { ...partial, adaSouth: false })])).toThrow(/A: ada 2/)
  })

  it('lists every bad station in one error', () => {
    const run = () => add([gtfs('A'), gtfs('B')], [row('A', { borough: 'Z' }), row('B', { ada: 9 })])
    expect(run).toThrow(/A: unknown borough[\s\S]*B: ada 9/)
  })
})

describe('addAccess exceptions', () => {
  const missingB = (over: object = {}) =>
    exceptions({ missing: { B: { borough: 'Q', ada: 'full', reason: 'opened after the last 39hk-dx4f update', ...over } } })

  it('uses an authored entry for a GTFS station with no catalog row', () => {
    const out = add([gtfs('A'), gtfs('B')], [row('A')], missingB())
    expect(out[1]).toMatchObject({ id: 'B', borough: 'Q', ada: 'full' })
    expect('adaPartial' in out[1]!).toBe(false)
  })

  it('takes adaPartial from a partial entry and none from a none entry', () => {
    const adaPartial = { north: true, south: false, note: 'Uptown only' }
    const p = add([gtfs('B')], [], missingB({ ada: 'partial', adaPartial }))
    expect(p[0]!.adaPartial).toEqual(adaPartial)
    expect(add([gtfs('B')], [], missingB({ ada: 'none' }))[0]).toMatchObject({ ada: 'none' })
  })

  it('checks an authored entry like a catalog row', () => {
    const run = (over: object) => () => add([gtfs('B')], [], missingB(over))
    expect(run({ borough: 'Z' })).toThrow(/B: unknown borough "Z"/)
    expect(run({ ada: 'some' })).toThrow(/B: exception ada "some"/)
    expect(run({ ada: 'partial' })).toThrow(/B: exception ada partial needs adaPartial/)
    expect(run({ ada: 'partial', adaPartial: { north: true, south: true, note: 'x' } })).toThrow(/B: ada 2/)
    expect(run({ adaPartial: { north: true, south: false, note: 'x' } })).toThrow(/B: exception has adaPartial but ada is full/)
  })

  it('still reports a missing station that has no entry, with the exceptions hint', () => {
    expect(() => add([gtfs('A'), gtfs('B')], [], missingB())).toThrow(/no catalog row: A \(/)
  })

  it('throws when a missing entry is no longer needed (the catalog has a row)', () => {
    expect(() => add([gtfs('B')], [row('B')], missingB())).toThrow(/"missing" B: the catalog has a row now, remove it/)
  })

  it('warns, without throwing, when a missing entry is not a GTFS station (a GTFS change)', () => {
    const r = addAccess([gtfs('A')], [row('A')], missingB())
    expect(r.stations.map((s) => s.id)).toEqual(['A'])
    expect(r.warnings).toEqual([expect.stringMatching(/"missing" B: not a GTFS station, remove it/)])
  })

  it('ignores a listed orphan catalog row', () => {
    const out = add([gtfs('A')], [row('A'), row('X')], exceptions({ orphans: { X: 'closed station' } }))
    expect(out.map((s) => s.id)).toEqual(['A'])
  })

  it('warns, without throwing, when a listed orphan is a GTFS station now', () => {
    const r = addAccess([gtfs('A')], [row('A')], exceptions({ orphans: { A: 'was closed' } }))
    expect(r.stations.map((s) => s.id)).toEqual(['A'])
    expect(r.warnings).toEqual([expect.stringMatching(/"orphans" A: it is a GTFS station now, remove it/)])
  })

  it('has no warnings when every exception is still needed', () => {
    const r = addAccess([gtfs('A'), gtfs('B')], [row('A'), row('X')], exceptions({ ...missingB(), orphans: { X: 'closed' } }))
    expect(r.warnings).toEqual([])
  })

  it('throws when a listed orphan has no catalog row (a catalog change)', () => {
    expect(() => add([gtfs('B')], [row('B')], exceptions({ orphans: { X: 'gone' } }))).toThrow(/"orphans" X: the catalog has no such row, remove it/)
  })

  it('throws on a duplicate catalog row', () => {
    expect(() => add([gtfs('A')], [row('A'), row('A', none)])).toThrow(/more than one row for: A/)
  })
})

describe('parseAccessExceptions', () => {
  it('accepts the committed shape', () => {
    expect(parseAccessExceptions({ missing: {}, orphans: {} })).toEqual(noExceptions)
  })

  it('rejects a wrong outer shape, extra keys, and entries without a reason', () => {
    expect(() => parseAccessExceptions([])).toThrow(/must be/)
    expect(() => parseAccessExceptions({ missing: {} })).toThrow(/must be/)
    expect(() => parseAccessExceptions({ missing: {}, orphans: {}, extra: 1 })).toThrow(/must be/)
    expect(() => parseAccessExceptions({ missing: { B: { borough: 'M', ada: 'none', reason: ' ' } }, orphans: {} })).toThrow(/"missing" B/)
    expect(() => parseAccessExceptions({ missing: {}, orphans: { X: 3 } })).toThrow(/"orphans" X/)
  })

  it('checks adaPartial when present', () => {
    const entry = (adaPartial: unknown) => ({ missing: { B: { borough: 'M', ada: 'partial', reason: 'new', adaPartial } }, orphans: {} })
    expect(parseAccessExceptions(entry({ north: true, south: false, note: 'Uptown only' }))).toBeTruthy()
    expect(() => parseAccessExceptions(entry('x'))).toThrow(/"missing" B: adaPartial needs boolean north and south/)
    expect(() => parseAccessExceptions(entry({ north: 1, south: false, note: 'n' }))).toThrow(/adaPartial/)
    expect(() => parseAccessExceptions(entry({ north: true, south: false }))).toThrow(/adaPartial/)
    expect(() => parseAccessExceptions(entry({ north: true, south: false, note: ' ' }))).toThrow(/non-empty note/)
  })
})

describe('the committed stations.json', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
  const stationsText = read('../../public/data/stations.json')
  const file = JSON.parse(stationsText) as StationsFile
  const exceptions = parseAccessExceptions(JSON.parse(read('../../data/stations/access-exceptions.json')))
  const catalog = JSON.parse(read('../../data/stations/catalog/stations.json')) as SodaHeader & { rows: CatalogStation[] }

  it('gives every station a borough and ada status', () => {
    for (const s of file.stations) {
      expect(s.borough, s.id).toBeTruthy()
      expect(s.ada, s.id).toBeTruthy()
    }
  })

  it('is what addAccess makes from the catalog (run npm run data:access if this fails)', () => {
    const bare = file.stations.map(({ borough: _b, ada: _a, adaPartial: _p, ...rest }) => rest)
    const access = addAccess(bare, catalog.rows, exceptions)
    expect(access.warnings).toEqual([])
    expect(toStableJson({ ...file, stations: access.stations }, 2)).toBe(stationsText)
  })
})
