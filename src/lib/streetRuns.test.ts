import { describe, expect, it } from 'vitest'
import type { StationStreets, StreetWay } from '../data/streetSchema'
import { runCandidates, streetLabelSources } from './streetRuns'

function way(id: number, highway: string, name: string | null, nodes: number[], footway?: string): StreetWay {
  return { id, highway, name, oneway: 0, nodes, ...(footway ? { footway } : {}) }
}

/** Points in meters; the file stores decimeters. */
function fixture(points: [number, number][], ways: StreetWay[]): StationStreets {
  return {
    stationId: 'T01',
    anchor: { lat: 40.7, lon: -73.9 },
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    nodeId: points.map((_, i) => (i === 0 ? 100 : 1)),
    x: points.map((p) => p[0] * 10),
    z: points.map((p) => p[1] * 10),
    ways,
    entrances: [],
  }
}

describe('runCandidates', () => {
  it('spaces points evenly, centered on the run, with unit tangents', () => {
    const c = runCandidates([[0, 0], [100, 0]], 40)
    expect(c.map((p) => p.x)).toEqual([30, 70])
    for (const p of c) expect([p.tx, p.tz, p.z]).toEqual([1, 0, 0])
  })

  it('puts one point at the middle of a short run', () => {
    expect(runCandidates([[0, 0], [0, 10]], 40)).toEqual([{ x: 0, z: 5, tx: 0, tz: 1 }])
  })

  it('follows the run around a bend', () => {
    const c = runCandidates([[0, 0], [50, 0], [50, 50]], 40)
    expect(c).toHaveLength(2)
    expect(c[0]).toEqual({ x: 30, z: 0, tx: 1, tz: 0 })
    expect(c[1]).toEqual({ x: 50, z: 20, tx: 0, tz: 1 })
  })

  it('gives nothing for a zero-length run', () => {
    expect(runCandidates([[3, 3], [3, 3]], 40)).toEqual([])
  })
})

describe('streetLabelSources', () => {
  it('merges a street split into several ways into one run, in either node order', () => {
    const file = fixture(
      [[0, 0], [60, 0], [120, 0], [200, 0]],
      [way(1, 'residential', 'North 7th Street', [0, 1]), way(2, 'residential', 'N 7th St', [2, 1]), way(3, 'residential', 'North 7th Street', [2, 3])],
    )
    const [s, ...rest] = streetLabelSources(file)
    expect(rest).toEqual([])
    expect(s!.text).toBe('N 7 St')
    expect(s!.lengthM).toBeCloseTo(200)
    expect(s!.runs).toHaveLength(1)
    expect(s!.runs[0]!.map((p) => p.x)).toEqual([20, 60, 100, 140, 180])
    expect(new Set(s!.runs[0]!.map((p) => p.tx))).toEqual(new Set([1]))
  })

  it('keeps the two carriageways of a dual street as two runs of one label, even where they meet', () => {
    // Two parallel carriageways 20 m apart, joined at a fork at the east end: chaining there would fold a U.
    const file = fixture(
      [[0, 0], [100, 0], [0, 20], [100, 20], [140, 10]],
      [way(1, 'primary', 'Broadway', [0, 1, 4]), way(2, 'primary', 'Broadway', [4, 3, 2])],
    )
    const sources = streetLabelSources(file)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.runs).toHaveLength(2)
  })

  it('keeps a closed residential loop as its own run, and drops plazas, footways and unnamed ways', () => {
    const file = fixture(
      [[0, 0], [50, 0], [50, 50], [0, 50], [200, 0], [300, 0]],
      [
        way(1, 'residential', 'Loop Road', [0, 1, 2, 3, 0]),
        way(2, 'pedestrian', 'Plaza', [0, 1, 2, 0]),
        way(3, 'footway', 'Side Walk', [4, 5], 'sidewalk'),
        way(4, 'residential', null, [4, 5]),
      ],
    )
    const sources = streetLabelSources(file)
    expect(sources.map((s) => s.text)).toEqual(['Loop Rd'])
    expect(sources[0]!.runs).toHaveLength(1)
    expect(sources[0]!.runs[0]).toHaveLength(5)
  })

  it('orders streets longest first and picks the most common spelling', () => {
    const file = fixture(
      [[0, 0], [100, 0], [0, 10], [0, 300], [300, 300]],
      [
        way(1, 'residential', 'Short Street', [0, 1]),
        way(2, 'secondary', 'West 96th St', [2, 3]),
        way(3, 'secondary', 'West 96th Street', [3, 4]),
        way(4, 'secondary', 'West 96th Street', [4, 3]),
      ],
    )
    const sources = streetLabelSources(file)
    expect(sources.map((s) => s.text)).toEqual(['W 96 St', 'Short St'])
  })

  it('throws on a node index outside the table', () => {
    expect(() => streetLabelSources(fixture([[0, 0]], [way(1, 'residential', 'A Street', [0, 5])]))).toThrow(/node index 5/)
  })
})
