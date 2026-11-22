import { describe, expect, it } from 'vitest'
import type { StationStreets, StreetWay } from '../data/streetSchema'
import { streetBuffers } from './streetBuffers'

const RGB = [0.1, 0.2, 0.3] as const

function way(id: number, highway: string, name: string | null, nodes: number[], footway?: string): StreetWay {
  return { id, highway, name, oneway: 0, nodes, ...(footway ? { footway } : {}) }
}

/** Nodes 0-3 a square, 4-5 a stub; decimeters from the anchor. */
function fixture(ways: StreetWay[]): StationStreets {
  return {
    stationId: 'L08',
    anchor: { lat: 40.717, lon: -73.957 },
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300,
    walkRadiusM: 100,
    nodeId: [100, 1, 1, 1, 1, 1],
    x: [0, 1000, 1000, 0, -250, -250],
    z: [0, 0, 1000, 1000, 15, 515],
    ways,
    entrances: [],
  }
}

describe('streetBuffers', () => {
  it('converts decimeters to meters at y = 0, one segment per node pair', () => {
    const b = streetBuffers(fixture([way(1, 'residential', 'Bedford Avenue', [4, 5, 0])]), RGB)
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
    )
    expect(b.positions.length).toBe(0)
    expect(b.colors.length).toBe(0)
  })

  it('keeps a closed residential loop, with n - 1 segments', () => {
    const b = streetBuffers(fixture([way(1, 'residential', 'Loop Rd', [0, 1, 2, 3, 0])]), RGB)
    expect(b.positions.length).toBe(4 * 6)
    expect(Array.from(b.positions.slice(-3))).toEqual([0, 0, 0])
  })

  it('keeps a pedestrianised street that is a line', () => {
    const b = streetBuffers(fixture([way(1, 'pedestrian', 'Fulton Mall', [0, 1, 2])]), RGB)
    expect(b.positions.length).toBe(2 * 6)
  })

  it('colors every vertex', () => {
    const b = streetBuffers(fixture([way(1, 'primary', 'Metropolitan Ave', [0, 1, 2]), way(2, 'tertiary', 'N 7 St', [3, 4])]), RGB)
    expect(b.colors.length).toBe(b.positions.length)
    for (let i = 0; i < b.colors.length; i += 3) {
      expect([b.colors[i], b.colors[i + 1], b.colors[i + 2]]).toEqual([...RGB].map(Math.fround))
    }
  })

  it('throws on a node index outside the node table', () => {
    expect(() => streetBuffers(fixture([way(7, 'residential', 'Bad St', [0, 6])]), RGB)).toThrow('Street way 7 of station L08: node index 6')
    expect(() => streetBuffers(fixture([way(8, 'residential', 'Bad St', [-1, 0])]), RGB)).toThrow('node index -1')
  })
})
