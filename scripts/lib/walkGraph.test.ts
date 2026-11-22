import { describe, expect, it } from 'vitest'
import { deltaDecode } from '../../src/data/codec.ts'
import { WALK_KINDS, type StationWalk } from '../../src/data/walkSchema.ts'
import { pinOf, STATION, way, type NodeMeters } from './streetsFixture.ts'
import type { PinWay } from './streetsOsm.ts'
import { buildAllWalks, buildStationWalk, edgeLengthDm, isWalkable, largestComponentShare, walkKind } from './walkGraph.ts'

// The fixture lays meters onto lat/lon rounded to 1e-6 degrees, about 1 dm, so decoded points are within a few dm.
const TOL_DM = 4

interface Edge {
  way: number
  kind: string
  ids: number[]
  pts: [number, number][]
  nodes: number[]
  length: number
}

function walk(nodes: NodeMeters, ways: PinWay[]): { file: StationWalk; excluded: number } {
  return buildStationWalk(STATION, pinOf(nodes, ways))
}

function edgesOf(file: StationWalk): Edge[] {
  const ids = deltaDecode(file.nodeId)
  const wayIds = deltaDecode(file.edgeWay)
  return file.edgeNodes.map((ns, e) => ({
    way: wayIds[e]!,
    kind: WALK_KINDS[file.edgeKind[e]!]!,
    ids: ns.map((i) => ids[i]!),
    pts: ns.map((i): [number, number] => [file.x[i]!, file.z[i]!]),
    nodes: ns,
    length: file.edgeLength[e]!,
  }))
}

/** A little town: a road with two crossings and a sidewalk, a steps way with a bend, a plaza ring, a long diagonal path. */
const TOWN_NODES: NodeMeters = {
  1: [-100, 0], 2: [-50, 0], 3: [50, 0], 4: [100, 0],
  5: [-50, -10], 6: [50, -10], 7: [0, -10],
  8: [0, 40], 9: [20, 40], 10: [20, 70],
  11: [150, 100], 12: [170, 100], 13: [170, 120], 14: [150, 120],
  15: [-200, 200], 16: [-100, 100], 17: [0, 0.3],
}
const TOWN: PinWay[] = [
  way(10, { highway: 'residential', name: 'Main Street' }, [1, 2, 17, 3, 4]),
  way(11, { highway: 'footway', footway: 'crossing' }, [2, 5]),
  way(12, { highway: 'footway', crossing: 'marked' }, [3, 6]),
  way(13, { highway: 'footway', footway: 'sidewalk' }, [5, 7, 6]),
  way(14, { highway: 'steps' }, [8, 9, 10]),
  way(15, { highway: 'pedestrian', name: 'Plaza' }, [11, 12, 13, 14, 11]),
  way(16, { highway: 'path' }, [15, 16, 1]),
]

describe('buildStationWalk', () => {
  it('shares a junction: a node two ways cross at is listed once and ends exactly four edges', () => {
    const { file } = walk({ 1: [-50, 0], 2: [0, 0], 3: [50, 0], 4: [0, -50], 5: [0, 50] }, [
      way(1, { highway: 'footway' }, [1, 2, 3]),
      way(2, { highway: 'footway' }, [4, 2, 5]),
    ])
    const ids = deltaDecode(file.nodeId)
    expect(ids).toEqual([1, 2, 3, 4, 5])
    const edges = edgesOf(file)
    expect(edges).toHaveLength(4)
    expect(edges.filter((e) => e.ids[0] === 2 || e.ids[e.ids.length - 1] === 2)).toHaveLength(4)
    expect(file.nodeId.length).toBe(5)
  })

  it('measures an L-shaped footway as one edge of 70 m', () => {
    const { file } = walk({ 1: [0, 0], 2: [30, 0], 3: [30, 40] }, [way(1, { highway: 'footway' }, [1, 2, 3])])
    const [edge, ...rest] = edgesOf(file)
    expect(rest).toEqual([])
    expect(Math.abs(edge!.length - 700)).toBeLessThanOrEqual(TOL_DM)
  })

  it('stores lengths that match the stored geometry and never fall under the straight line between the ends', () => {
    for (const e of edgesOf(walk(TOWN_NODES, TOWN).file)) {
      expect(e.length).toBe(edgeLengthDm(e.pts))
      const [a, b] = [e.pts[0]!, e.pts[e.pts.length - 1]!]
      expect(e.length).toBeGreaterThanOrEqual(Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])))
    }
  })

  it('connects two crossings by footways alone, and cuts the road where the crossings meet it', () => {
    const { file } = walk(TOWN_NODES, TOWN)
    const edges = edgesOf(file)
    const road = edges.filter((e) => e.kind === 'road')
    expect(road.map((e) => [e.ids[0], e.ids[e.ids.length - 1]])).toEqual([[1, 2], [2, 3], [3, 4]])
    const reach = new Set([2])
    for (let grew = true; grew; ) {
      grew = false
      for (const e of edges.filter((x) => x.kind !== 'road')) {
        const [a, b] = [e.ids[0]!, e.ids[e.ids.length - 1]!]
        if (reach.has(a) !== reach.has(b)) {
          reach.add(a).add(b)
          grew = true
        }
      }
    }
    expect(reach.has(3)).toBe(true)
  })

  it('flags steps, including a named one, and nothing else', () => {
    const { file } = walk(
      { 1: [0, 0], 2: [10, 0], 3: [10, 10], 4: [50, 50], 5: [60, 50], 6: [60, 60] },
      [way(1, { highway: 'steps' }, [1, 2, 3]), way(2, { highway: 'steps', name: 'Hill Steps' }, [4, 5, 6]), way(3, { highway: 'footway' }, [3, 4])],
    )
    expect(edgesOf(file).map((e) => [e.way, e.kind])).toEqual([[1, 'steps'], [2, 'steps'], [3, 'footway']])
  })

  it('clips at the first vertex past 300 m and keeps ways whose segment crosses the circle or a ring partly outside', () => {
    const { file } = walk(
      { 1: [100, 0], 2: [290, 0], 3: [310, 0], 4: [500, 0], 5: [400, 100], 6: [500, 100], 7: [-400, 250], 8: [400, 250], 9: [200, 0], 10: [400, 0], 11: [400, 200], 12: [200, 200] },
      [
        way(1, { highway: 'footway' }, [1, 2, 3, 4]),
        way(2, { highway: 'footway' }, [5, 6]),
        way(3, { highway: 'footway' }, [7, 8]),
        way(4, { highway: 'footway' }, [9, 10, 11, 12, 9]),
      ],
    )
    const ids = deltaDecode(file.nodeId)
    expect(ids).toContain(3)
    expect(ids).not.toContain(4)
    expect(ids).not.toContain(5)
    expect(edgesOf(file).map((e) => e.way)).toEqual([1, 3, 4])
    expect(ids).toEqual(expect.arrayContaining([7, 8, 9, 10, 11, 12]))
  })

  it('keeps an open way whose clipped span would close on itself whole', () => {
    const nodes: NodeMeters = { 1: [0, -700], 2: [0, -310], 3: [50, -100], 4: [-50, -100], 5: [0, -700] }
    const { file } = walk(nodes, [way(1, { highway: 'footway' }, [1, 2, 3, 4, 2, 5])])
    expect(deltaDecode(file.nodeId)).toEqual([1, 2, 3, 4, 5])
  })

  it('drops ways pedestrians may not use, counts them, and does not split at a node only they touch', () => {
    const nodes: NodeMeters = { 1: [0, 0], 2: [10, 10], 3: [30, 0], 4: [0, 50], 5: [40, 50], 6: [0, -50], 7: [40, -50], 8: [0, 80], 9: [40, 80], 10: [-40, 20] }
    const { file, excluded } = walk(nodes, [
      way(1, { highway: 'footway' }, [1, 2, 3]),
      way(2, { highway: 'footway', foot: 'no' }, [2, 10]),
      way(3, { highway: 'footway', foot: 'use_sidepath' }, [4, 5]),
      way(4, { highway: 'service', name: 'Gate Way', access: 'private' }, [6, 7]),
      way(5, { highway: 'service', name: 'Dock Way', access: 'private', foot: 'yes' }, [8, 9]),
    ])
    expect(excluded).toBe(3)
    expect(edgesOf(file).map((e) => e.way)).toEqual([1, 5])
    expect(edgesOf(file)[0]!.ids).toEqual([1, 2, 3])
  })

  it('leaves no edge interior entry in any other edge', () => {
    const fixtures: StationWalk[] = [
      walk(TOWN_NODES, TOWN).file,
      walk({ 1: [-50, 0], 2: [0, 0], 3: [50, 0], 4: [0, -50], 5: [0, 50] }, [way(1, { highway: 'footway' }, [1, 2, 3]), way(2, { highway: 'footway' }, [4, 2, 5])]).file,
      walk({ 1: [0, 0], 2: [30, 10], 3: [60, 0], 4: [30, -30] }, [way(1, { highway: 'pedestrian', name: 'Ring' }, [1, 2, 3, 4, 1]), way(2, { highway: 'footway' }, [2, 4])]).file,
    ]
    for (const file of fixtures) {
      const seen = new Map<number, number>()
      for (const ns of file.edgeNodes) for (const n of ns) seen.set(n, (seen.get(n) ?? 0) + 1)
      for (const ns of file.edgeNodes) {
        expect(ns.length).toBeGreaterThanOrEqual(2)
        for (const n of ns.slice(1, -1)) expect(seen.get(n)).toBe(1)
      }
    }
  })

  it('drops a near-collinear vertex but keeps a junction on a straight line', () => {
    const near = walk({ 1: [0, 0], 2: [15, 0.1], 3: [30, 0] }, [way(1, { highway: 'footway' }, [1, 2, 3])])
    expect(edgesOf(near.file).map((e) => e.ids)).toEqual([[1, 3]])
    const cross = walk({ 1: [0, 0], 2: [15, 0], 3: [30, 0], 4: [15, 30] }, [way(1, { highway: 'footway' }, [1, 2, 3]), way(2, { highway: 'footway' }, [2, 4])])
    expect(edgesOf(cross.file).map((e) => e.ids)).toEqual([[1, 2], [2, 3], [2, 4]])
  })

  it('orders edges by way id then along the way', () => {
    const { file } = walk(TOWN_NODES, [...TOWN].reverse())
    const wayIds = deltaDecode(file.edgeWay)
    expect(wayIds).toEqual([...wayIds].sort((a, b) => a - b))
    const road = edgesOf(file).filter((e) => e.way === 10)
    road.slice(1).forEach((e, i) => expect(e.ids[0]).toBe(road[i]!.ids[road[i]!.ids.length - 1]))
  })

  it('keeps a lone ring as one edge from a node back to itself, and writes arrays for no ways', () => {
    const ring = walk({ 1: [0, 0], 2: [20, 0], 3: [20, 20], 4: [0, 20] }, [way(1, { highway: 'pedestrian', name: 'Plaza' }, [1, 2, 3, 4, 1])])
    const [edge, ...rest] = edgesOf(ring.file)
    expect(rest).toEqual([])
    expect(edge!.nodes[0]).toBe(edge!.nodes[edge!.nodes.length - 1])
    expect(edge!.nodes).toHaveLength(5)
    const none = walk({}, [])
    expect(none.file).toMatchObject({ nodeId: [], x: [], z: [], edgeWay: [], edgeKind: [], edgeLength: [], edgeNodes: [], format: 1, radiusM: 300, attribution: ['© OpenStreetMap contributors'] })
  })

  it('builds one result per station', () => {
    expect(buildAllWalks([STATION], pinOf(TOWN_NODES, TOWN)).map((r) => r.file.stationId)).toEqual(['T01'])
  })
})

describe('walkKind and isWalkable', () => {
  const kind = (tags: Record<string, string>): string => walkKind(way(9, tags, [1, 2]))

  it('maps each highway class', () => {
    expect(kind({ highway: 'steps' })).toBe('steps')
    expect(kind({ highway: 'footway', footway: 'sidewalk' })).toBe('sidewalk')
    expect(kind({ highway: 'footway', footway: 'crossing' })).toBe('crossing')
    expect(kind({ highway: 'footway', crossing: 'uncontrolled' })).toBe('crossing')
    expect(kind({ highway: 'footway' })).toBe('footway')
    expect(kind({ highway: 'path' })).toBe('path')
    expect(kind({ highway: 'pedestrian', name: 'Plaza' })).toBe('pedestrian')
    for (const highway of ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']) {
      expect(kind({ highway, name: 'X' })).toBe('road')
    }
  })

  it('throws, naming the way, on a class it does not know', () => {
    expect(() => kind({ highway: 'cycleway' })).toThrow(/way 9: highway=cycleway/)
    expect(() => kind({})).toThrow(/way 9/)
  })

  it('excludes foot and access closures unless foot allows them, and keeps the soft ones', () => {
    for (const tags of [{ foot: 'no' }, { foot: 'private' }, { foot: 'use_sidepath' }, { access: 'no' }, { access: 'private' }, { access: 'private', foot: 'no' }] as Record<string, string>[]) {
      expect(isWalkable({ highway: 'footway', ...tags }), JSON.stringify(tags)).toBe(false)
    }
    for (const tags of [{}, { access: 'private', foot: 'yes' }, { access: 'no', foot: 'designated' }, { access: 'no', foot: 'permissive' }, { access: 'destination' }, { access: 'customers' }, { access: 'delivery' }, { foot: 'discouraged' }, { foot: 'yes' }] as Record<string, string>[]) {
      expect(isWalkable({ highway: 'footway', ...tags }), JSON.stringify(tags)).toBe(true)
    }
  })
})

describe('largestComponentShare', () => {
  const literal = (nodes: number, edges: [number, number, number][]): StationWalk => ({
    stationId: 'T01', anchor: { lat: 40.7, lon: -74 }, format: 1, license: 'ODbL-1.0', attribution: [], osmTimestamp: '', radiusM: 300,
    nodeId: Array.from({ length: nodes }, () => 1), x: Array(nodes).fill(0), z: Array(nodes).fill(0),
    edgeWay: edges.map(() => 0), edgeKind: edges.map(() => 0), edgeLength: edges.map((e) => e[2]), edgeNodes: edges.map((e) => [e[0], e[1]]),
  })

  it('weighs components by edge length', () => {
    expect(largestComponentShare(literal(5, [[0, 1, 20], [1, 2, 10], [3, 4, 10]]))).toEqual({ share: 0.75, components: 2 })
  })

  it('is 1 for one component and for none', () => {
    expect(largestComponentShare(literal(3, [[0, 1, 5], [1, 2, 5]]))).toEqual({ share: 1, components: 1 })
    expect(largestComponentShare(literal(0, []))).toEqual({ share: 1, components: 0 })
  })
})
