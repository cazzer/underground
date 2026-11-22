import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeStationWalk, expectStationWalk, loadStationWalk } from './loadStationWalk'
import type { StationWalk } from './walkSchema'

const URL = '/underground/data/walk/L08.json'

/** Three nodes at (0, 0), (3, 0), (3, 4) m; a sidewalk 0-1, a road 1-2 and a degenerate ring on node 2. */
function valid(): StationWalk {
  return {
    stationId: 'L08',
    anchor: { lat: 40.717, lon: -73.957 },
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300,
    nodeId: [10, 5, 7],
    x: [0, 30, 30],
    z: [0, 0, 40],
    edgeWay: [100, 20, 0],
    edgeKind: [0, 6, 6],
    edgeLength: [30, 40, 0],
    edgeNodes: [[0, 1], [1, 2], [2, 2]],
  }
}

describe('expectStationWalk', () => {
  it('returns a well-formed file unchanged', () => {
    const raw = valid()
    expect(expectStationWalk(raw, 'L08', URL)).toBe(raw)
  })

  it.each([
    ['null', null],
    ['a mismatched stationId', { ...valid(), stationId: 'L06' }],
    ['a non-finite anchor', { ...valid(), anchor: { lat: Number.NaN, lon: -73.9 } }],
    ['a missing anchor', { ...valid(), anchor: undefined }],
    ['another format', { ...valid(), format: 2 }],
    ['a zero radius', { ...valid(), radiusM: 0 }],
    ['a short x column', { ...valid(), x: [0] }],
    ['a missing z column', { ...valid(), z: undefined }],
    ['a short edgeKind column', { ...valid(), edgeKind: [0] }],
    ['a short edgeLength column', { ...valid(), edgeLength: [30] }],
    ['a missing edgeNodes column', { ...valid(), edgeNodes: undefined }],
    ['a missing edgeWay column', { ...valid(), edgeWay: {} }],
  ])('throws, naming the url, for %s', (_, raw) => {
    expect(() => expectStationWalk(raw, 'L08', URL)).toThrow(`${URL}: not a walk file for L08`)
  })
})

describe('decodeStationWalk', () => {
  it('decodes ids, decimeters to meters, lengths and adjacency', () => {
    const g = decodeStationWalk(valid())
    expect(g.nodeId).toEqual([10, 15, 22])
    expect(g.edgeWay).toEqual([100, 120, 120])
    expect(Array.from(g.x)).toEqual([0, 3, 3])
    expect(Array.from(g.z)).toEqual([0, 0, 4])
    expect(Array.from(g.edgeKind)).toEqual([0, 6, 6])
    expect(Array.from(g.edgeLength)).toEqual([3, 4, 0])
    expect(g.edgeNodes.map((n) => Array.from(n))).toEqual([[0, 1], [1, 2], [2, 2]])
    expect(g.radiusM).toBe(300)
    // Node 0: edge 0. Node 1: edges 0, 1. Node 2: edge 1 only; the ring edge 2 is left out.
    const adj = (n: number) => Array.from(g.adjEdge.subarray(g.adjStart[n]!, g.adjStart[n + 1]!))
    expect([adj(0), adj(1), adj(2)]).toEqual([[0], [0, 1], [1]])
    expect(g.adjEdge.length).toBe(4)
  })

  it('keeps a zero-length edge at length 0', () => {
    const file = { ...valid(), x: [0, 0, 30], z: [0, 0, 40], edgeLength: [0, 50, 0] }
    expect(decodeStationWalk(file).edgeLength[0]).toBe(0)
  })

  it('throws, naming the station and edge, on a bad node index', () => {
    const file = { ...valid(), edgeNodes: [[0, 1], [1, 3], [2, 2]] }
    expect(() => decodeStationWalk(file)).toThrow('L08: edge 1 has node 3 out of range')
  })
  it('throws on a kind outside WALK_KINDS', () => {
    expect(() => decodeStationWalk({ ...valid(), edgeKind: [0, 7, 6] })).toThrow('L08: edge 1 has kind 7')
    expect(() => decodeStationWalk({ ...valid(), edgeKind: [0, 1.5, 6] })).toThrow('edge 1 has kind 1.5')
  })
  it('throws on an edge of one node', () => {
    expect(() => decodeStationWalk({ ...valid(), edgeNodes: [[0], [1, 2], [2, 2]] })).toThrow('edge 0 has under two nodes')
  })
  it('throws when a length is off by 1 dm', () => {
    expect(() => decodeStationWalk({ ...valid(), edgeLength: [31, 40, 0] })).toThrow('edge 0 is 3.00 m long, the file says 3.1 m')
    expect(() => decodeStationWalk({ ...valid(), edgeLength: [29, 40, 0] })).toThrow('edge 0')
  })
})

describe('the real L08 and A27 files', () => {
  it('decodes L08 to 533 nodes and 711 edges, every length within 0.05 m of the file', () => {
    const file = JSON.parse(readFileSync('public/data/walk/L08.json', 'utf8')) as StationWalk
    const g = decodeStationWalk(file)
    expect(g.x.length).toBe(533)
    expect(g.edgeLength.length).toBe(711)
    for (let e = 0; e < g.edgeLength.length; e++) expect(Math.abs(g.edgeLength[e]! - file.edgeLength[e]! / 10)).toBeLessThanOrEqual(0.05)
  })

  it('decodes the zero-length edge 398 of A27 as length 0', () => {
    const file = JSON.parse(readFileSync('public/data/walk/A27.json', 'utf8')) as StationWalk
    expect(decodeStationWalk(file).edgeLength[398]).toBe(0)
  })
})

describe('loadStationWalk', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches the walk file under the base url', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(valid())))
    vi.stubGlobal('fetch', fetchMock)
    const file = await loadStationWalk('/underground/', 'L08')
    expect(file?.stationId).toBe('L08')
    expect(fetchMock).toHaveBeenCalledWith(URL, expect.anything())
  })

  it('gives null with one warning for a station with no walk file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadStationWalk('/underground/', 'L08')).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain(URL)
  })

  it('rejects on any other HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(loadStationWalk('/underground/', 'L08')).rejects.toThrow(`${URL}: HTTP 500`)
  })

  it('rejects a file for another station', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...valid(), stationId: 'L06' }))))
    await expect(loadStationWalk('/underground/', 'L08')).rejects.toThrow(`${URL}: not a walk file for L08`)
  })
})
