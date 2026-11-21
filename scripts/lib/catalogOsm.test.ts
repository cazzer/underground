import { describe, expect, it } from 'vitest'
import { catalogBbox, trimOverpassCatalog } from './catalogOsm.ts'

// 0.001 degrees of latitude is about 111 m; of longitude at 40.7 N about 84 m.
const station = { lat: 40.7, lon: -74 }
const radii = { platformRadiusM: 250, trackRadiusM: 300 }
const r7 = (n: number) => Math.round(n * 1e7) / 1e7
const pt = (dLat: number, dLon = 0) => ({ lat: r7(station.lat + dLat), lon: r7(station.lon + dLon) })

const way = (id: number, tags: Record<string, string>, geometry: unknown[]) => ({ type: 'way', id, version: 3, timestamp: 'x', user: 'u', tags, geometry })
const response = (elements: unknown[], base: unknown = '2026-11-21T17:48:36Z') => ({ osm3s: { timestamp_osm_base: base }, elements })

describe('trimOverpassCatalog', () => {
  it('keeps a platform within its radius and drops one beyond it', () => {
    const near = way(1, { railway: 'platform' }, [pt(0.002), pt(0.0021)]) // about 222 m
    const far = way(2, { railway: 'platform' }, [pt(0.003), pt(0.0031)]) // about 333 m
    expect(trimOverpassCatalog(response([near, far]), [station], radii).ways.map((w) => w.id)).toEqual([1])
  })
  it('uses the larger track radius for tracks and keeps the whole way when one vertex is near', () => {
    const track = way(3, { railway: 'subway' }, [pt(0.0027), pt(0.01), pt(0.02)]) // first vertex about 300 m
    const out = trimOverpassCatalog(response([track]), [station], { ...radii, trackRadiusM: 310 })
    expect(out.ways[0]!.points).toHaveLength(3)
    expect(trimOverpassCatalog(response([track]), [station], { ...radii, trackRadiusM: 290 }).ways).toEqual([])
  })
  it('keeps only the listed tags per kind and records closed', () => {
    const ring = [pt(0), pt(0.0001), pt(0.0001, 0.0001), pt(0)]
    const platform = way(4, { railway: 'platform', level: '-2', name: 'P', surface: 'concrete', operator: 'MTA' }, ring)
    const track = way(5, { railway: 'subway', tunnel: 'yes', operator: 'MTA', surface: 'x', level: '-1' }, [pt(0), pt(0.0001)])
    const [a, b] = trimOverpassCatalog(response([track, platform]), [station], radii).ways
    expect(a).toEqual({ id: 4, version: 3, tags: { railway: 'platform', level: '-2', name: 'P' }, closed: true, points: [[40.7, -74], [40.7001, -74], [40.7001, -73.9999], [40.7, -74]] })
    expect(b!.tags).toEqual({ railway: 'subway', level: '-1', tunnel: 'yes', operator: 'MTA' })
    expect(b!.closed).toBe(false)
  })
  it('keeps an open platform way with closed false and lists platform relations', () => {
    const open = way(6, { railway: 'platform' }, [pt(0), pt(0.0001), pt(0.0002)])
    const out = trimOverpassCatalog(response([{ type: 'relation', id: 99 }, open, { type: 'relation', id: 12 }]), [station], radii)
    expect(out.ways[0]).toMatchObject({ id: 6, closed: false })
    expect(out.skippedRelations).toEqual([12, 99])
  })
  it('throws naming the element for a bad coordinate (a clipped node is null)', () => {
    const bad = way(7, { railway: 'subway' }, [pt(0), null])
    expect(() => trimOverpassCatalog(response([bad]), [station], radii)).toThrow(/way 7\.geometry\[1\]/)
  })
  it('throws on a missing base timestamp and on an unexpected railway value', () => {
    expect(() => trimOverpassCatalog({ osm3s: {}, elements: [] }, [station], radii)).toThrow(/timestamp_osm_base/)
    expect(() => trimOverpassCatalog(response([way(8, { railway: 'rail' }, [pt(0), pt(0.0001)])]), [station], radii)).toThrow(/way 8.*railway/)
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
