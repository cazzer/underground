import { describe, expect, it } from 'vitest'
import { toLatLon } from '../../src/lib/projection.ts'
import type { CatalogEntrance, CatalogEquipment, CatalogStation, OsmCatalogWay } from './catalogTypes.ts'
import { buildAllFacts, isMainTrack, isSubwayPlatform } from './catalogFacts.ts'
import type { Catalog } from './catalogFacts.ts'
import { classifyStation } from './archetype.ts'

const BASE = { lat: 40.7, lon: -74 }
/** Catalog points are [lat, lon]; the slice is laid out in meters east/south of BASE. */
const ll = (x: number, z: number): [number, number] => {
  const p = toLatLon({ x, z }, BASE)
  return [p.lat, p.lon]
}
const station = (id: string, name: string, x: number, z: number, complexId = id, structure: CatalogStation['structure'] = 'Subway'): CatalogStation => {
  const [lat, lon] = ll(x, z)
  return { gtfsStopId: id, stationId: `m${id}`, complexId, division: 'IND', line: 'X', name, borough: 'Bk', routes: ['L'], structure, lat, lon, ada: 0, adaNorth: false, adaSouth: false, adaNotes: null, northLabel: 'N', southLabel: 'S' }
}
const platform = (id: number, x0: number, x1: number, z0: number, z1: number, tags: Record<string, string> = {}): OsmCatalogWay => ({
  id,
  tags: { railway: 'platform', level: '-2', ...tags },
  closed: true,
  points: [ll(x0, z0), ll(x1, z0), ll(x1, z1), ll(x0, z1), ll(x0, z0)],
})
const track = (id: number, z: number, x0 = -400, x1 = 400, tags: Record<string, string> = {}): OsmCatalogWay => ({ id, tags: { railway: 'subway', ...tags }, closed: false, points: [ll(x0, z), ll(x1, z)] })
const machine = (code: string, stationId: string, over: Partial<CatalogEquipment> = {}): CatalogEquipment => ({
  code, kind: 'elevator', revenue: true, stationId, complexId: stationId, lat: 41, lon: -73, serving: 'mezzanine to platform', rise: "20'", landings: '2', direction: 'Both', ada: true, streetAccess: false, mezzanine1Access: true, mezzanine2Access: false, platformAccess: true, ...over,
})
const entrance = (gtfsStopIds: string[], x: number, z: number): CatalogEntrance => {
  const [lat, lon] = ll(x, z)
  return { type: 'Stair', entry: true, exit: true, lat, lon, gtfsStopIds, stationId: `m${gtfsStopIds[0]}`, complexId: gtfsStopIds[0]! }
}

const catalog = (): Catalog => ({
  stations: [station('A01', 'Alpha', 0, 0), station('B01', 'Beta', 600, 0), station('C01', 'Gamma', 0, 40), station('D01', 'Delta', 3000, 0, 'X9'), station('D02', 'Delta Two', 3050, 0, 'X9')],
  entrances: [entrance(['A01'], -50, 20), entrance(['A01'], 50, -20), entrance(['B01'], 600, 20), entrance(['A01', 'C01'], 0, 60)],
  equipment: [machine('EL1', 'mA01'), machine('EL2', 'mA01', { revenue: false }), machine('EL3', 'mB01', { serving: null, lat: null, lon: null })],
  platforms: [
    platform(1, -60, 60, -3, 3, { operator: 'New York City Transit Authority', network: 'NYC Subway' }),
    platform(2, 540, 660, -3, 3),
    platform(3, -60, 60, 10, 14, { operator: 'Port Authority of New York and New Jersey', network: 'PATH' }),
    platform(4, -60, 60, 20, 24, { network: 'LIRR' }),
  ],
  tracks: [
    track(10, -4.7, -400, 900),
    track(11, 4.7, -400, 900),
    track(12, 9, -400, 400, { service: 'crossover' }),
    track(13, 12, -400, 400, { operator: 'Port Authority Trans-Hudson' }),
    track(14, 600, -400, 400),
  ],
})

describe('platform and track filters', () => {
  it('drops PATH, LIRR and open rings, keeps NYCT, SIR and untagged platforms', () => {
    const c = catalog()
    expect(c.platforms.map(isSubwayPlatform)).toEqual([true, true, false, false])
    expect(isSubwayPlatform({ ...c.platforms[0]!, closed: false })).toBe(false)
    expect(isSubwayPlatform(platform(9, 0, 10, 0, 3, { operator: 'Staten Island Rapid Transit Operating Authority', network: 'Staten Island Railway' }))).toBe(true)
  })

  it('keeps NYCT (no operator tag) and SIR tracks, siding or spur included; drops crossovers, PATH and other operators', () => {
    const c = catalog()
    expect(c.tracks.map(isMainTrack)).toEqual([true, true, false, false, true])
    expect(isMainTrack(track(1, 0, -1, 1, { operator: 'Staten Island Rapid Transit Operating Authority' }))).toBe(true)
    expect(isMainTrack(track(1, 0, -1, 1, { operator: 'South Brooklyn Railway' }))).toBe(false)
    for (const service of ['siding', 'spur', 'yard']) expect(isMainTrack(track(1, 0, -1, 1, { service }))).toBe(true)
  })
})

describe('buildAllFacts', () => {
  const facts = buildAllFacts(catalog())
  const get = (id: string) => facts.find((f) => f.stationId === id)!

  it('uses the station point as the origin and the catalog structure', () => {
    expect(get('A01').origin).toEqual({ lat: station('A01', '', 0, 0).lat, lon: station('A01', '', 0, 0).lon })
    expect(get('A01')).toMatchObject({ structure: 'subway', name: 'Alpha', complex: false })
    expect(buildAllFacts({ ...catalog(), stations: [station('E01', 'El', 0, 0, 'E01', 'Open Cut')] })[0]!.structure).toBe('open-cut')
  })

  it('gives each platform to the nearest station only, not the neighbor 600 m away', () => {
    expect(get('A01').platforms.map((p) => p.osmWay)).toEqual([1])
    expect(get('B01').platforms.map((p) => p.osmWay)).toEqual([2])
    expect(get('A01').platforms[0]!.levelTag).toBe('-2')
  })

  it('projects the platform around the station origin (x east, z south)', () => {
    const xs = get('A01').platforms[0]!.outline.map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(-60, 0)
    expect(Math.max(...xs)).toBeCloseTo(60, 0)
    const zs = get('B01').platforms[0]!.outline.map((p) => p[1])
    expect(Math.max(...zs)).toBeCloseTo(3, 0)
  })

  it('assigns tracks within 150 m and clips them, leaving out crossover and PATH tracks', () => {
    expect(get('A01').tracks.map((t) => t.ref)).toEqual(['10', '11'])
    expect(get('B01').tracks.map((t) => t.ref)).toEqual(['10', '11'])
    expect(get('D01').tracks).toEqual([])
  })

  it('flags stations that share a complexId as complexes', () => {
    expect(get('D01').complex).toBe(true)
    expect(get('D02').complex).toBe(true)
    expect(get('A01').complex).toBe(false)
  })

  it('records an ambiguity when another station point is close to a platform', () => {
    expect(get('A01').ambiguity?.join('')).toMatch(/platform way 1 is also within 60 m of C01 Gamma/)
    expect(get('B01').ambiguity).toBeUndefined()
  })

  it('takes E&E rows by station id, revenue only, with no coordinates trusted', () => {
    expect(get('A01').equipment.map((e) => e.code)).toEqual(['EL1'])
    const b = get('B01').equipment[0]!
    expect(b).toMatchObject({ code: 'EL3', serving: '', at: [0, 0] })
  })

  it('takes entrance rows whose gtfsStopIds include the station', () => {
    expect(get('A01').entrances).toHaveLength(3)
    expect(get('C01').entrances).toHaveLength(1)
    expect(get('B01').entrances).toHaveLength(1)
  })

  it('classifies an island station from the slice, with the ambiguity as a deduction', () => {
    const r = classifyStation(get('A01'))
    expect(r.params).toMatchObject({ platformType: 'island', trackCount: 2 })
    expect(r.reasons.join('\n')).toMatch(/platform ownership is ambiguous.*-0.1/)
  })
})
