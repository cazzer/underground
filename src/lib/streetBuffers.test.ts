import { describe, expect, it } from 'vitest'
import type { StationStreets, StreetWay } from '../data/streetSchema'
import { edgeFade, streetBuffers } from './streetBuffers'

const RGB = [0.1, 0.2, 0.3] as const
const BG = [0.9, 0.8, 0.7] as const

function way(id: number, highway: string, name: string | null, nodes: number[], footway?: string): StreetWay {
  return { id, highway, name, oneway: 0, nodes, ...(footway ? { footway } : {}) }
}

/** Nodes 0-3 a square, 4-5 a stub; decimeters from the anchor. */
function fixture(ways: StreetWay[], extra: { x: number[]; z: number[] } = { x: [], z: [] }): StationStreets {
  return {
    stationId: 'L08',
    anchor: { lat: 40.717, lon: -73.957 },
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300,
    walkRadiusM: 100,
    nodeId: [100, 1, 1, 1, 1, 1, ...extra.x.map(() => 1)],
    x: [0, 1000, 1000, 0, -250, -250, ...extra.x],
    z: [0, 0, 1000, 1000, 15, 515, ...extra.z],
    ways,
    entrances: [],
  }
}

describe('streetBuffers', () => {
  it('converts decimeters to meters at y = 0, one segment per node pair', () => {
    const b = streetBuffers(fixture([way(1, 'residential', 'Bedford Avenue', [4, 5, 0])]), RGB, BG)
    expect(Array.from(b.positions)).toEqual([-25, 0, 1.5, -25, 0, 51.5, -25, 0, 51.5, 0, 0, 0])
    expect(b.bands).toBeUndefined()
  })

  it('drops footways, unnamed ways, closed pedestrian plazas and names with no tokens', () => {
    const b = streetBuffers(
      fixture([
        way(1, 'footway', 'Bedford Avenue', [0, 1], 'sidewalk'),
        way(2, 'residential', null, [1, 2]),
        way(3, 'pedestrian', 'Some Plaza', [0, 1, 2, 3, 0]),
        way(4, 'residential', '...', [2, 3]),
        way(5, 'steps', 'Stair St', [3, 4]),
      ]),
      RGB,
      BG,
    )
    expect(b.positions.length).toBe(0)
    expect(b.colors.length).toBe(0)
  })

  it('keeps a closed residential loop, with n - 1 segments', () => {
    const b = streetBuffers(fixture([way(1, 'residential', 'Loop Rd', [0, 1, 2, 3, 0])]), RGB, BG)
    expect(b.positions.length).toBe(4 * 6)
    expect(Array.from(b.positions.slice(-3))).toEqual([0, 0, 0])
  })

  it('keeps a pedestrianised street that is a line', () => {
    const b = streetBuffers(fixture([way(1, 'pedestrian', 'Fulton Mall', [0, 1, 2])]), RGB, BG)
    expect(b.positions.length).toBe(2 * 6)
  })

  it('colors every vertex', () => {
    const b = streetBuffers(fixture([way(1, 'primary', 'Metropolitan Ave', [0, 1, 2]), way(2, 'tertiary', 'N 7 St', [3, 4])]), RGB, BG)
    expect(b.colors.length).toBe(b.positions.length)
    for (let i = 0; i < b.colors.length; i += 3) {
      expect([b.colors[i], b.colors[i + 1], b.colors[i + 2]]).toEqual([...RGB].map(Math.fround))
    }
  })

  it('throws on a node index outside the node table', () => {
    expect(() => streetBuffers(fixture([way(7, 'residential', 'Bad St', [0, 6])]), RGB, BG)).toThrow('Street way 7 of station L08: node index 6')
    expect(() => streetBuffers(fixture([way(8, 'residential', 'Bad St', [-1, 0])]), RGB, BG)).toThrow('node index -1')
  })

  it('mixes to the fade color over the last 70 m of the radius, splitting a segment at the ramp ends', () => {
    // Node 6 is 400 m east: the segment from the anchor crosses the ramp start (230 m) and the radius (300 m).
    const b = streetBuffers(fixture([way(1, 'residential', 'Long St', [0, 6])], { x: [4000], z: [0] }), RGB, BG)
    const xs = Array.from(b.positions).filter((_, i) => i % 3 === 0)
    expect(xs).toEqual([0, 230, 230, 300, 300, 400])
    const reds = Array.from(b.colors).filter((_, i) => i % 3 === 0)
    expect(reds).toEqual([RGB[0], RGB[0], RGB[0], BG[0], BG[0], BG[0]].map(Math.fround))
  })

  it('splits a chord that dips into the ramp at both crossings', () => {
    // From (-280, 250) to (280, 250) m: nearest the anchor at 250 m, inside the ramp; it leaves the radius twice.
    const b = streetBuffers(fixture([way(1, 'residential', 'Chord St', [6, 7])], { x: [-2800, 2800], z: [2500, 2500] }), RGB, BG)
    const xs = Array.from(b.positions).filter((_, i) => i % 3 === 0)
    const r300 = Math.fround(Math.sqrt(300 ** 2 - 250 ** 2))
    expect(xs.length).toBe(6)
    expect(xs[1]).toBeCloseTo(-r300, 3)
    expect(xs[4]).toBeCloseTo(r300, 3)
  })
})

describe('edgeFade', () => {
  it('is 0 at the center and through the ramp start, 1 at the radius and past it, monotone between', () => {
    expect(edgeFade(0, 300)).toBe(0)
    expect(edgeFade(230, 300)).toBe(0)
    expect(edgeFade(300, 300)).toBe(1)
    expect(edgeFade(350, 300)).toBe(1)
    let last = 0
    for (let r = 0; r <= 320; r += 1) {
      const w = edgeFade(r, 300)
      expect(w).toBeGreaterThanOrEqual(last)
      last = w
    }
  })

  it('ramps from the center when the radius is shorter than the fade', () => {
    expect(edgeFade(25, 50)).toBe(0.5)
  })
})
