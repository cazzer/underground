import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../src/data/schema.ts'
import { readCatalogStations } from './accessInputs.ts'
import { buildComplexes, checkComplexLeads, type ComplexStation } from './stationComplexes.ts'

const st = (id: string, lat: number, lon: number, routes: string[] = ['A']): ComplexStation => ({ id, lat, lon, routes })
const row = (gtfsStopId: string, complexId: string) => ({ gtfsStopId, complexId })

describe('buildComplexes', () => {
  it('keeps groups of 2 or more only, lead first, sorted by lead', () => {
    const stations = [st('Z1', 40.7, -74), st('Z2', 40.7, -74.001), st('B1', 40.8, -73.9), st('A1', 40.6, -73.8), st('A2', 40.6, -73.801)]
    const rows = [row('Z1', 'z'), row('Z2', 'z'), row('B1', 'b'), row('A1', 'a'), row('A2', 'a')]
    const { complexes, warnings } = buildComplexes(stations, rows)
    expect(complexes.map((g) => [...g].sort())).toEqual([['A1', 'A2'], ['Z1', 'Z2']])
    expect(complexes.map((g) => g[0])).toEqual([...complexes.map((g) => g[0]!)].sort())
    expect(warnings).toEqual([])
  })

  it('picks the member nearest the centroid, the rest by id', () => {
    const stations = [st('C', 40.7, -74.0), st('A', 40.7, -74.0036), st('B', 40.7, -74.0006)]
    const rows = [row('C', 'x'), row('A', 'x'), row('B', 'x')]
    // centroid lon is -74.0014; B is nearest.
    expect(buildComplexes(stations, rows).complexes).toEqual([['B', 'A', 'C']])
  })

  it('breaks a tie within one metre by routes, then id', () => {
    const pair = [st('M1', 40.7, -74.0, ['1']), st('M2', 40.7, -74.001, ['A', 'C'])]
    expect(buildComplexes(pair, [row('M1', 'x'), row('M2', 'x')]).complexes).toEqual([['M2', 'M1']])
    const same = [st('N2', 40.7, -74.0, ['A']), st('N1', 40.7, -74.001, ['A'])]
    expect(buildComplexes(same, [row('N1', 'x'), row('N2', 'x')]).complexes).toEqual([['N1', 'N2']])
  })

  it('warns about a member stations.json lacks and drops a group left with one', () => {
    const { complexes, warnings } = buildComplexes([st('A', 40.7, -74)], [row('A', 'x'), row('GONE', 'x')])
    expect(complexes).toEqual([])
    expect(warnings).toEqual(['catalog complex x: member GONE is not in stations.json'])
  })

  it('throws on a GTFS id in two complexes', () => {
    const stations = [st('A', 40.7, -74), st('B', 40.7, -74.001)]
    expect(() => buildComplexes(stations, [row('A', 'x'), row('B', 'x'), row('A', 'y')])).toThrow(/A is in two complexes/)
  })
})

describe('checkComplexLeads', () => {
  const complexes = [['L03', '635', 'R20']]
  it('passes when an interior covers the lead, or no complex member', () => {
    expect(() => checkComplexLeads([{ stationId: '635', memberStationIds: ['635', 'L03', 'R20'] }, { stationId: 'X' }], complexes)).not.toThrow()
  })
  it('throws when an interior covers a member but not its lead', () => {
    expect(() => checkComplexLeads([{ stationId: '635' }], complexes)).toThrow(/covers 635 of complex L03 but not L03/)
  })
})

describe('committed stations.json', () => {
  it('has the complexes the pinned catalog gives (rerun npm run data:access when stale)', () => {
    const file = JSON.parse(readFileSync(new URL('../../public/data/stations.json', import.meta.url), 'utf8')) as StationsFile
    const built = buildComplexes(file.stations, readCatalogStations())
    expect(built.warnings).toEqual([])
    expect(file.complexes).toEqual(built.complexes)
  })

  it('leads the two-member ties by routes (168 St is A09, not 112)', () => {
    const file = JSON.parse(readFileSync(new URL('../../public/data/stations.json', import.meta.url), 'utf8')) as StationsFile
    expect(file.complexes).toContainEqual(['A09', '112'])
  })
})
