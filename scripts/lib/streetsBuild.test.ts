import { describe, expect, it } from 'vitest'
import { deltaDecode } from '../../src/data/codec.ts'
import { toLatLon } from '../../src/lib/projection.ts'
import { isClosedRing } from '../../src/lib/streetClass.ts'
import { buildStationStreets, clipSpan, onewayOf, simplifySpans, WALK_RADIUS_M } from './streetsBuild.ts'
import type { EntranceInput } from './streetsEntrances.ts'
import { ENTRANCES_OPEN_NY_NOTE, MTA_CREDIT } from './stationMerge.ts'
import { pinOf, STATION, way, type NodeMeters } from './streetsFixture.ts'

type P = readonly [number, number]

describe('clipSpan', () => {
  it('keeps a long segment whose ends are both outside the radius', () => {
    expect(clipSpan([[-1000, 100], [1000, 100]], 300, false)).toEqual([0, 1])
  })

  it('drops a way entirely outside', () => {
    expect(clipSpan([[-1000, 400], [1000, 400]], 300, false)).toBeNull()
  })

  it('cuts at the vertices around the in-range segments', () => {
    const pts: P[] = [[-900, 0], [-500, 0], [-100, 0], [100, 0], [500, 0], [900, 0]]
    expect(clipSpan(pts, 300, false)).toEqual([1, 4])
  })

  it('keeps a way that leaves and re-enters as one span', () => {
    const pts: P[] = [[0, 0], [0, 500], [500, 500], [500, 0], [100, 0]]
    expect(clipSpan(pts, 300, false)).toEqual([0, 4])
  })

  it('keeps a closed way whole or drops it, never opens it', () => {
    const crossing: P[] = [[200, 0], [600, 0], [600, 600], [200, 600], [200, 0]]
    expect(clipSpan(crossing, 300, true)).toEqual([0, 4])
    const outside: P[] = [[400, 400], [600, 400], [600, 600], [400, 600], [400, 400]]
    expect(clipSpan(outside, 300, true)).toBeNull()
  })
})

describe('simplifySpans', () => {
  const pts: Record<number, P> = { 1: [0, 0], 2: [100, 0], 3: [200, 0], 4: [200, 100], 5: [200, 200] }
  const ptOf = (id: number): P => pts[id]!

  it('drops a collinear middle vertex and keeps corners and ends', () => {
    expect(simplifySpans([[1, 2, 3, 4, 5]], ptOf, 0.5)).toEqual([[1, 3, 5]])
  })

  it('keeps a vertex another way uses, so junctions survive', () => {
    expect(simplifySpans([[1, 2, 3, 4, 5], [2, 4]], ptOf, 0.5)).toEqual([[1, 2, 3, 4, 5], [2, 4]])
  })

  it('keeps a ring at 4 entries or more', () => {
    const ring: Record<number, P> = { 1: [0, 0], 2: [100, 0], 3: [100, 100], 4: [0, 100], 5: [50, 0] }
    const out = simplifySpans([[1, 5, 2, 3, 4, 1]], (id) => ring[id]!, 0.5)[0]!
    expect(out).toEqual([1, 2, 3, 4, 1])
    expect(isClosedRing(out)).toBe(true)
    const sliver: Record<number, P> = { 1: [0, 0], 2: [100, 0], 3: [50, 0] }
    expect(simplifySpans([[1, 2, 3, 1]], (id) => sliver[id]!, 0.5)[0]).toEqual([1, 2, 3, 1])
  })
})

describe('onewayOf', () => {
  it('reads the OSM tag values', () => {
    for (const v of ['yes', 'true', '1']) expect(onewayOf(v)).toEqual({ value: 1, known: true })
    for (const v of ['-1', 'reverse']) expect(onewayOf(v)).toEqual({ value: -1, known: true })
    for (const v of [undefined, 'no', 'false', '0', 'reversible', 'alternating']) expect(onewayOf(v)).toEqual({ value: 0, known: true })
    expect(onewayOf('conditional')).toEqual({ value: 0, known: false })
  })
})

const residential = (name: string, extra: Record<string, string> = {}): Record<string, string> => ({ highway: 'residential', name, ...extra })
const entranceAt = (p: P, over: Partial<EntranceInput> = {}): EntranceInput => {
  const ll = toLatLon({ x: p[0], z: p[1] }, STATION)
  return { type: 'Stair', entry: true, exit: true, lat: ll.lat, lon: ll.lon, gtfsStopIds: ['T01'], ...over }
}

describe('buildStationStreets', () => {
  const nodes: NodeMeters = {
    10: [-200, 0],
    11: [0, 0],
    12: [200, 0],
    20: [0, -200],
    21: [0, 200],
    30: [-500, 100],
    31: [-400, 100],
    40: [60, 10],
    41: [75, 10],
    42: [90, 10],
    50: [-120, 20],
    51: [-90, 20],
  }
  const ways = [
    way(1, residential('Main St', { oneway: 'yes' }), [10, 11, 12]),
    way(2, residential('Cross Ave'), [20, 11, 21]),
    way(3, residential('Far St'), [30, 31]),
    way(4, { highway: 'footway', footway: 'sidewalk' }, [40, 41, 42]),
    way(5, { highway: 'footway' }, [50, 51]),
  ]
  const result = buildStationStreets(STATION, pinOf(nodes, ways), [entranceAt([60, -8])])
  const file = result.file

  it('keeps the ways within reach, as one node table with delta-coded ascending ids', () => {
    expect(file.ways.map((w) => w.id)).toEqual([1, 2, 4, 5])
    const ids = deltaDecode(file.nodeId)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(ids).toEqual([10, 11, 12, 20, 21, 40, 42, 50, 51])
    expect(file.x.length).toBe(ids.length)
  })

  it('drops the middle of a straight footway and keeps the shared junction', () => {
    expect(file.ways.find((w) => w.id === 4)!.nodes.map((i) => deltaDecode(file.nodeId)[i])).toEqual([40, 42])
    const main = file.ways.find((w) => w.id === 1)!
    const cross = file.ways.find((w) => w.id === 2)!
    expect(main.nodes[1]).toBe(cross.nodes[1])
  })

  it('writes integer decimeters from the anchor', () => {
    const ids = deltaDecode(file.nodeId)
    const at = (id: number): P => [file.x[ids.indexOf(id)]!, file.z[ids.indexOf(id)]!]
    expect(at(12)[0]).toBeGreaterThanOrEqual(1999)
    expect(at(12)[0]).toBeLessThanOrEqual(2001)
    expect(Math.abs(at(11)[0])).toBeLessThanOrEqual(1)
    for (const v of [...file.x, ...file.z]) expect(Number.isInteger(v)).toBe(true)
    expect(file.x.some((v) => Object.is(v, -0))).toBe(false)
  })

  it('reads the tags: name, oneway, footway class', () => {
    expect(file.ways[0]).toEqual({ id: 1, highway: 'residential', name: 'Main St', oneway: 1, nodes: [0, 1, 2] })
    expect(file.ways.find((w) => w.id === 4)).toMatchObject({ highway: 'footway', footway: 'sidewalk', name: null, oneway: 0 })
    expect('footway' in file.ways[0]!).toBe(false)
  })

  it('cuts footways at the walk radius but roadways at the full radius', () => {
    expect(WALK_RADIUS_M).toBeLessThan(300)
    const far = buildStationStreets(STATION, pinOf({ 1: [-250, 0], 2: [-250, 50], 3: [-0, 0] }, [way(7, { highway: 'footway' }, [1, 2]), way(8, residential('Far Rd'), [1, 2])]), [])
    expect(far.file.ways.map((w) => w.id)).toEqual([8])
  })

  it('joins entrances and credits the sources it used', () => {
    expect(file.entrances).toHaveLength(1)
    expect(file.entrances[0]).toMatchObject({ street: 'Main St', cross: null, side: 'north', stopIds: ['T01'] })
    expect(file.attribution).toEqual(['© OpenStreetMap contributors', MTA_CREDIT, ENTRANCES_OPEN_NY_NOTE])
    expect(file.license).toBe('ODbL-1.0')
    expect([file.radiusM, file.walkRadiusM]).toEqual([300, WALK_RADIUS_M])
    expect(file.osmTimestamp).toBe('2026-01-01T00:00:00Z')
  })

  it('credits only OSM when the station has no entrances, and warns about no entrances', () => {
    const none = buildStationStreets(STATION, pinOf(nodes, ways), [])
    expect(none.file.attribution).toEqual(['© OpenStreetMap contributors'])
    expect(none.file.entrances).toEqual([])
    expect(none.log.map((l) => l.kind)).toContain('no-entrances')
  })

  it('writes an empty file with a warning when no way is near', () => {
    const empty = buildStationStreets(STATION, pinOf({ 1: [5000, 0], 2: [5100, 0] }, [way(9, residential('Away St'), [1, 2])]), [])
    expect(empty.file).toMatchObject({ nodeId: [], x: [], z: [], ways: [] })
    expect(empty.log.find((l) => l.kind === 'no-ways')!.line).toMatch(/^WARNING/)
  })

  it('keeps a self-touching open way whole rather than clip it to a ring, and logs it', () => {
    const loop: NodeMeters = { 1: [350, 4000], 2: [350, 2000], 3: [350, 0], 4: [200, 100], 5: [200, -100] }
    const built = buildStationStreets(STATION, pinOf(loop, [way(5, residential('Loop St'), [1, 2, 3, 4, 5, 3])]), [])
    const w = built.file.ways[0]!
    expect(isClosedRing(w.nodes)).toBe(false)
    expect(w.nodes).toEqual([0, 1, 2, 3, 1])
    expect(built.log.map((l) => l.kind)).toContain('whole-way')
  })

  it('keeps a closed way closed and logs an unknown oneway', () => {
    const ring: NodeMeters = { 1: [100, 100], 2: [200, 100], 3: [200, 200], 4: [100, 200] }
    const built = buildStationStreets(STATION, pinOf(ring, [way(6, residential('Round Rd', { oneway: 'conditional' }), [1, 2, 3, 4, 1])]), [])
    expect(isClosedRing(built.file.ways[0]!.nodes)).toBe(true)
    expect(built.log.map((l) => l.kind)).toContain('oneway')
  })
})
