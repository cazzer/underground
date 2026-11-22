import { describe, expect, it } from 'vitest'
import { ROADWAY_HIGHWAYS } from '../../src/lib/streetClass.ts'
import { ROAD_CLASSES, STREET_TAGS, WALK_CLASSES, mergeOverpass, stationsWithoutNamedWay, streetsDistance, streetsQuery, trimOverpassStreets } from './streetsOsm.ts'
import type { StreetsOptions, StreetStation } from './streetsOsm.ts'
import { shardCell, shardFileName, shardStreets } from './streetsShard.ts'

// 0.001 degrees of latitude is about 111 m; of longitude at 40.7 N about 84 m.
const station: StreetStation = { id: 'T01', name: 'Test St', lat: 40.7, lon: -74 }
const options: StreetsOptions = { radiusM: 300, walk: true }
const pt = (dLat: number, dLon = 0) => ({ lat: 40.7 + dLat, lon: -74 + dLon })
const way = (id: number, tags: Record<string, string>, points: unknown[], nodes?: unknown[]) => ({
  type: 'way',
  id,
  tags,
  nodes: nodes ?? points.map((_, i) => id * 100 + i + 1),
  geometry: points,
})
const road = (id: number, points: unknown[], nodes?: unknown[]) => way(id, { highway: 'residential', name: `Street ${id}` }, points, nodes)
const response = (elements: unknown[], extra: Record<string, unknown> = {}) => ({ osm3s: { timestamp_osm_base: '2026-11-21T17:48:36Z' }, elements, ...extra })
const trim = (elements: unknown[], o: StreetsOptions = options, stations: StreetStation[] = [station]) => trimOverpassStreets(response(elements), stations, o)
const near = road(1, [pt(0.001), pt(0.001, 0.001)])

describe('the class lists', () => {
  it('are no wider than the street classes the client draws', () => {
    for (const c of [...ROAD_CLASSES, ...WALK_CLASSES].filter((c) => c !== 'footway' && c !== 'steps' && c !== 'path')) {
      expect(ROADWAY_HIGHWAYS.has(c), c).toBe(true)
    }
  })
  it('keep the walk-only classes out of the roadway set', () => {
    for (const c of ['footway', 'steps', 'path']) expect(ROADWAY_HIGHWAYS.has(c), c).toBe(false)
  })
})

describe('streetsQuery', () => {
  const stations = [pt(0), pt(0.01, 0.01)]
  it('has one clause per station and a walking clause', () => {
    const q = streetsQuery(stations, 300, true)
    expect(q.match(/around:300/g)).toHaveLength(2)
    expect(q).toContain('way(around:300,40.7,-74)["highway"];')
    expect(q).toContain('footway|steps|path')
    expect(q.startsWith('[out:json][timeout:600];(')).toBe(true)
    expect(q.endsWith('out geom;')).toBe(true)
  })
  it('leaves out the walking classes with no walk', () => {
    const q = streetsQuery(stations, 300, false)
    expect(q).not.toContain('footway')
    expect(q).toContain('residential')
  })
})

describe('streetsDistance', () => {
  it('measures to a segment, not to its vertices', () => {
    // Vertices about 560 m either side of the station; the segment passes 111 m north of it.
    expect(streetsDistance(station, [pt(0.001, -0.0067), pt(0.001, 0.0067)])).toBeCloseTo(111.3, 0)
  })
})

describe('trimOverpassStreets', () => {
  it('keeps a way whole when one vertex is near and drops one entirely out of range', () => {
    const partly = road(2, [pt(0.002), pt(0.02), pt(0.03)])
    const far = road(3, [pt(0.01), pt(0.011)])
    expect(trim([partly, far]).ways.map((w) => w.id)).toEqual([2])
    expect(trim([partly, far]).ways[0]!.nodes).toHaveLength(3)
  })
  it('keeps a long segment passing within the radius with both vertices outside it', () => {
    const long = road(4, [pt(0.001, -0.02), pt(0.001, 0.02)]) // 1.7 km either side
    expect(trim([long, near]).ways.map((w) => w.id)).toEqual([1, 4])
  })
  it('sorts by id, keeps only STREET_TAGS and rounds coordinates to 1e-6', () => {
    const tags = { highway: 'residential', name: 'A St', oneway: 'yes', lanes: '2', surface: 'asphalt', 'tiger:cfcc': 'A41', bridge: 'yes', layer: '1' }
    const a = way(9, tags, [{ lat: 40.70123456, lon: -74.00000049 }, { lat: 40.7013, lon: -74.0001 }])
    const out = trim([a, near])
    expect(out.ways.map((w) => w.id)).toEqual([1, 9])
    expect(out.ways[1]!.tags).toEqual({ highway: 'residential', name: 'A St', oneway: 'yes', bridge: 'yes', layer: '1' })
    expect(out.nodes.get(901)).toEqual([40.701235, -74])
    expect(STREET_TAGS).toContain('crossing')
  })
  it('keeps unnamed walking ways but not unnamed roads', () => {
    const sidewalk = way(5, { highway: 'footway', footway: 'sidewalk' }, [pt(0.001), pt(0.0011)])
    const plaza = way(6, { highway: 'pedestrian' }, [pt(0.001), pt(0.0011), pt(0.0012), pt(0.001)])
    expect(trim([near, sidewalk, plaza]).ways.map((w) => w.id)).toEqual([1, 5, 6])
    expect(() => trim([near, way(7, { highway: 'service' }, [pt(0.001), pt(0.0011)])])).toThrow(/way 7: highway=service has no name/)
  })
  it('throws on a footway when walking ways are off', () => {
    const sidewalk = way(5, { highway: 'footway', footway: 'sidewalk' }, [pt(0.001), pt(0.0011)])
    expect(() => trim([near, sidewalk], { ...options, walk: false })).toThrow(/way 5: unexpected highway=footway/)
    expect(() => trim([near, way(8, { highway: 'pedestrian' }, [pt(0.001), pt(0.0011)])], { ...options, walk: false })).toThrow(/way 8: highway=pedestrian has no name/)
  })
  it('throws on a class outside the lists', () => {
    expect(() => trim([near, way(10, { highway: 'motorway', name: 'BQE' }, [pt(0.001), pt(0.0011)])])).toThrow(/way 10: unexpected highway=motorway/)
    expect(() => trim([near, way(11, { highway: 'primary_link', name: 'Ramp' }, [pt(0.001), pt(0.0011)])])).toThrow(/primary_link/)
  })
  it('throws on a remark, a missing timestamp and a non-way element', () => {
    const remark = 'runtime error: Query timed out in "query" at line 1 after 601 seconds.'
    expect(() => trimOverpassStreets(response([near], { remark }), [station], options)).toThrow(/remark.*Query timed out/)
    expect(() => trimOverpassStreets({ osm3s: {}, elements: [] }, [station], options)).toThrow(/timestamp_osm_base/)
    expect(() => trim([near, { type: 'node', id: 12, lat: 40.7, lon: -74 }])).toThrow(/node 12: expected a way/)
  })
  it('throws on a duplicate way id', () => {
    expect(() => trim([near, near])).toThrow(/way 1: duplicate way id/)
  })
  it('throws on mismatched or short geometry, bad coordinates and bad node ids', () => {
    expect(() => trim([road(13, [pt(0.001), pt(0.0011)], [1, 2, 3])])).toThrow(/way 13: 3 node ids but 2 geometry points/)
    expect(() => trim([road(14, [pt(0.001)])])).toThrow(/way 14.geometry: expected at least 2 points/)
    expect(() => trim([road(15, [pt(0.001), null])])).toThrow(/way 15.geometry\[1\]/)
    expect(() => trim([road(16, [pt(0.001), { lat: NaN, lon: -74 }])])).toThrow(/way 16.geometry\[1\].lat/)
    expect(() => trim([road(17, [pt(0.001), pt(0.0011)], [5, 0])])).toThrow(/way 17.nodes\[1\].*positive integer/)
    expect(() => trim([road(18, [pt(0.001), pt(0.0011)], [5, 1.5])])).toThrow(/way 18.nodes\[1\]/)
  })
  it('throws when one node id has two coordinates', () => {
    const a = road(19, [pt(0.001), pt(0.0011)], [77, 78])
    const b = road(20, [pt(0.001), pt(0.0012)], [77, 79])
    expect(trim([a, b]).nodes.size).toBe(3)
    const c = road(21, [pt(0.0012), pt(0.0011)], [77, 78])
    expect(() => trim([a, c])).toThrow(/way 21: node 77 is at/)
  })
  it('shares a node id between ways without error', () => {
    const out = trim([road(22, [pt(0.001), pt(0.0011)], [5, 6]), road(23, [pt(0.0011), pt(0.0012)], [6, 7])])
    expect(out.nodes.size).toBe(3)
  })
  it('throws when a station has no named way within the radius, naming it, unless excepted', () => {
    const unnamed = way(24, { highway: 'footway' }, [pt(0.001), pt(0.0011)])
    expect(() => trim([unnamed])).toThrow(/1 of 1 stations have no named way within 300 m \(T01 Test St\)/)
    expect(() => trim([road(25, [pt(0.01), pt(0.011)])])).toThrow(/T01 Test St/)
    expect(trim([unnamed], { ...options, exceptions: ['T01'] }).ways).toHaveLength(1)
  })
})

describe('stationsWithoutNamedWay', () => {
  it('finds the stations a way segment does not reach', () => {
    const other: StreetStation = { id: 'T02', name: 'Far St', lat: 40.8, lon: -74 }
    const out = trimOverpassStreets(response([near]), [station], options)
    expect(stationsWithoutNamedWay([station, other], out.ways, out.nodes, 300).map((s) => s.id)).toEqual(['T02'])
  })
})

describe('mergeOverpass', () => {
  it('deduplicates by id, keeps the earliest timestamp and throws on a remark', () => {
    const a = { osm3s: { timestamp_osm_base: '2026-11-21T10:00:00Z' }, elements: [near, road(2, [pt(0.001), pt(0.0011)])] }
    const b = { osm3s: { timestamp_osm_base: '2026-11-21T09:00:00Z' }, elements: [near, road(3, [pt(0.001), pt(0.0011)])] }
    const merged = mergeOverpass([a, b]) as { osm3s: { timestamp_osm_base: string }; elements: { id: number }[] }
    expect(merged.elements.map((e) => e.id)).toEqual([1, 2, 3])
    expect(merged.osm3s.timestamp_osm_base).toBe('2026-11-21T09:00:00Z')
    expect(() => mergeOverpass([a, { ...b, remark: 'runtime error: out of memory' }])).toThrow(/remark/)
  })
})

describe('shardStreets', () => {
  // Way 3 starts in the next cell east and ends on node 2, which way 1 and way 2 share: a border node.
  const streets = trim([
    road(1, [pt(0.001), pt(0.002)], [1, 2]),
    road(2, [pt(0.002), pt(0.003)], [2, 3]),
    road(3, [pt(0.0005, 0.03), pt(0.002)], [4, 2]),
  ])
  const shards = shardStreets(streets)

  it('puts each way in exactly one shard, by its first vertex', () => {
    expect(shards).toHaveLength(2)
    expect(shards.flatMap((s) => s.ways.map((w) => w.id)).sort()).toEqual([1, 2, 3])
    for (const s of shards) {
      for (const w of s.ways) {
        const first = streets.nodes.get(w.nodes[0]!)!
        expect(shardCell({ lat: first[0], lon: first[1] })).toEqual(s.cell)
      }
    }
    expect(new Set(shards.map((s) => shardFileName(s.cell))).size).toBe(2)
  })
  it('gives each shard a node table sorted by id that covers exactly its ways', () => {
    for (const s of shards) {
      const ids = s.nodes.map((n) => n[0])
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
      expect(ids).toEqual([...new Set(s.ways.flatMap((w) => w.nodes))].sort((a, b) => a - b))
    }
  })
  it('repeats a border node in both shards with the same coordinates', () => {
    const copies = shards.map((s) => s.nodes.find((n) => n[0] === 2))
    expect(copies[0]).toBeDefined()
    expect(copies[0]).toEqual(copies[1])
  })
})
