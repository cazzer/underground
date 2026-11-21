import { describe, expect, it } from 'vitest'
import { catalogBbox, stationsWithoutWay, trimOverpassCatalog } from './catalogOsm.ts'
import type { CatalogRadii } from './catalogOsm.ts'

// 0.001 degrees of latitude is about 111 m; of longitude at 40.7 N about 84 m.
const station = { gtfsStopId: 'T01', name: 'Test St', lat: 40.7, lon: -74 }
const radii: CatalogRadii = { platformRadiusM: 250, trackRadiusM: 300, platformExceptions: ['T01'], trackExceptions: ['T01'] }
const r7 = (n: number) => Math.round(n * 1e7) / 1e7
const pt = (dLat: number, dLon = 0) => ({ lat: r7(station.lat + dLat), lon: r7(station.lon + dLon) })

const NYCT = { operator: 'New York City Transit Authority', network: 'NYC Subway' }
const way = (id: number, tags: Record<string, string>, geometry: unknown[]) => ({ type: 'way', id, tags, geometry })
const response = (elements: unknown[], extra: Record<string, unknown> = {}) => ({ osm3s: { timestamp_osm_base: '2026-11-21T17:48:36Z' }, elements, ...extra })
const trim = (elements: unknown[], r: CatalogRadii = radii) => trimOverpassCatalog(response(elements), [station], r)

describe('trimOverpassCatalog', () => {
  it('keeps a platform within its radius and drops one beyond it', () => {
    const near = way(1, { railway: 'platform' }, [pt(0.002), pt(0.0021)]) // about 222 m
    const far = way(2, { railway: 'platform' }, [pt(0.003), pt(0.0031)]) // about 333 m
    expect(trim([near, far]).platforms.map((w) => w.id)).toEqual([1])
  })
  it('uses the larger track radius for tracks and keeps the whole way when one vertex is near', () => {
    const track = way(3, { railway: 'subway', ...NYCT }, [pt(0.0027), pt(0.01), pt(0.02)]) // first vertex about 300 m
    expect(trim([track], { ...radii, trackRadiusM: 310 }).tracks[0]!.points).toHaveLength(3)
    expect(trim([track], { ...radii, trackRadiusM: 290 }).tracks).toEqual([])
  })
  it('keeps platform operator and network, and records closed', () => {
    const ring = [pt(0), pt(0.0001), pt(0.0001, 0.0001), pt(0)]
    const platform = way(4, { railway: 'platform', level: '-2', name: 'P', surface: 'concrete', operator: 'PATH', network: 'PATH' }, ring)
    expect(trim([platform]).platforms[0]).toEqual({
      id: 4,
      tags: { railway: 'platform', level: '-2', name: 'P', operator: 'PATH', network: 'PATH' },
      closed: true,
      points: [[40.7, -74], [40.7001, -74], [40.7001, -73.9999], [40.7, -74]],
    })
  })
  it('keeps only the listed track tags and drops the NYCT operator but not other operators', () => {
    const nycts = { railway: 'subway', tunnel: 'yes', surface: 'x', level: '-1', operator: 'New York City Transit Authority', network: 'NYC Subway' }
    const sir = { railway: 'subway', operator: 'Staten Island Rapid Transit Operating Authority', network: 'Staten Island Railway' }
    const out = trim([way(5, nycts, [pt(0), pt(0.0001)]), way(6, sir, [pt(0), pt(0.0001)])]).tracks
    expect(out[0]).toMatchObject({ id: 5, tags: { railway: 'subway', level: '-1', tunnel: 'yes', network: 'NYC Subway' }, closed: false })
    expect(out[1]!.tags).toEqual(sir)
  })
  it('keeps an open platform way with closed false and lists platform relations', () => {
    const open = way(7, { railway: 'platform' }, [pt(0), pt(0.0001), pt(0.0002)])
    const out = trim([{ type: 'relation', id: 99 }, open, { type: 'relation', id: 12 }])
    expect(out.platforms[0]).toMatchObject({ id: 7, closed: false })
    expect(out.skippedRelations).toEqual([12, 99])
  })
  it('throws naming the element for a bad coordinate (a clipped node is null)', () => {
    expect(() => trim([way(8, { railway: 'subway', ...NYCT }, [pt(0), null])])).toThrow(/way 8\.geometry\[1\]/)
  })
  it('throws on a missing base timestamp and on an unexpected railway value', () => {
    expect(() => trimOverpassCatalog({ osm3s: {}, elements: [] }, [station], radii)).toThrow(/timestamp_osm_base/)
    expect(() => trim([way(9, { railway: 'rail' }, [pt(0), pt(0.0001)])])).toThrow(/way 9.*railway/)
  })
  it('throws on a runtime-error remark even though the HTTP status was 200', () => {
    const remark = 'runtime error: Query timed out in "query" at line 1 after 181 seconds.'
    expect(() => trimOverpassCatalog(response([], { remark }), [station], radii)).toThrow(/remark.*Query timed out/)
  })
  it('throws when a station has no platform within the radius, naming it, unless excepted', () => {
    const track = way(10, { railway: 'subway', ...NYCT }, [pt(0), pt(0.0001)])
    const strict: CatalogRadii = { platformRadiusM: 250, trackRadiusM: 300, trackExceptions: ['T01'] }
    expect(() => trim([track], strict)).toThrow(/1 of 1 stations.*T01 Test St/)
    expect(() => trim([way(11, { railway: 'platform' }, [pt(0.004), pt(0.0041)])], strict)).toThrow(/T01 Test St/)
    expect(trim([way(12, { railway: 'platform' }, [pt(0.001), pt(0.0011)])], strict).platforms).toHaveLength(1)
    expect(trim([track], radii).tracks).toHaveLength(1)
  })
})

describe('trimOverpassCatalog track checks', () => {
  const platform = way(20, { railway: 'platform' }, [pt(0.001), pt(0.0011)])
  it('throws on a nearby track with no operator instead of reading it as NYCT', () => {
    const noOperator = way(21, { railway: 'subway', network: 'NYC Subway' }, [pt(0), pt(0.0001)])
    expect(() => trim([platform, noOperator])).toThrow(/way 21: track has no operator/)
  })
  it('does not require a network tag (most tracks have none) and keeps one raw', () => {
    const plain = way(22, { railway: 'subway', operator: 'Other Operator' }, [pt(0), pt(0.0001)])
    const named = way(24, { railway: 'subway', ...NYCT }, [pt(0), pt(0.0001)])
    const out = trim([platform, plain, named]).tracks
    expect(out[0]!.tags).toEqual({ railway: 'subway', operator: 'Other Operator' })
    expect(out[1]!.tags).toEqual({ railway: 'subway', network: 'NYC Subway' })
  })
  it('ignores a far track that lacks the tags', () => {
    const far = way(23, { railway: 'subway' }, [pt(0.05), pt(0.0501)])
    expect(trim([platform, far]).tracks).toEqual([])
  })
  it('throws when a station has no track within its radius, unless excepted', () => {
    const strict: CatalogRadii = { platformRadiusM: 250, trackRadiusM: 300 }
    expect(() => trim([platform], strict)).toThrow(/1 of 1 stations have no track way.*T01 Test St/)
    expect(trim([platform], { ...strict, trackExceptions: ['T01'] }).tracks).toEqual([])
  })
})

describe('stationsWithoutWay', () => {
  it('lists the stations with no platform vertex in range', () => {
    const far = { ...station, gtfsStopId: 'T02', name: 'Far St', lat: 40.8 }
    const platform = { id: 1, tags: {}, closed: false, points: [[40.7005, -74], [40.7006, -74]] as [number, number][] }
    expect(stationsWithoutWay([station, far], [platform], 250).map((s) => s.gtfsStopId)).toEqual(['T02'])
  })
})

describe('catalogBbox', () => {
  it('pads the points by the distance, rounded outward', () => {
    const box = catalogBbox([{ lat: 40.5, lon: -74.2 }, { lat: 40.9, lon: -73.7 }], 500)
    expect(box.south).toBeLessThan(40.5 - 0.0044)
    expect(box.north).toBeGreaterThan(40.9 + 0.0044)
    expect(box.west).toBeLessThan(-74.2 - 0.0058)
    expect(box.east).toBeGreaterThan(-73.7 + 0.0058)
    expect(box.north - 40.9).toBeLessThan(0.006)
  })
})
