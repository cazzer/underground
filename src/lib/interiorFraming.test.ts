import { describe, expect, it } from 'vitest'
import type { LocalPoint, StationInterior } from '../data/stationSchema'
import { formatDepth, interiorBounds, interiorFocusTarget, levelLabels, paddedHull } from './interiorFraming'

const interior: StationInterior = {
  stationId: 'X01',
  name: 'Fixture',
  anchor: { lat: 40.7, lon: -73.9 },
  license: 'ODbL-1.0',
  attribution: [],
  levels: [
    { id: 'street', name: 'Street', kind: 'street', y: 0 },
    { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: -4 },
    { id: 'plat', name: 'Platform', kind: 'platform', y: -8 },
  ],
  platforms: [
    {
      id: 'P1',
      level: 'plat',
      outline: [
        [-20, -3],
        [20, -3],
        [20, 3],
        [-20, 3],
      ],
      tracks: [],
      osmRef: 'way/1',
      sources: ['osm'],
    },
  ],
  slabs: [
    {
      id: 'S1',
      level: 'mezz',
      name: 'Mezzanine',
      outline: [
        [-5, 5],
        [5, 5],
        [5, 15],
        [-5, 15],
      ],
      sources: ['authored'],
    },
  ],
  connectors: [],
  entrances: [{ id: 'E1', x: 30, z: 20, type: 'Stair', entry: true, exit: true, connectors: [], sources: ['nyopendata'] }],
  fareLines: [],
}

describe('interiorBounds', () => {
  it('spans outlines and entrances', () => {
    expect(interiorBounds(interior)).toEqual({ minX: -20, maxX: 30, minZ: -3, maxZ: 20 })
  })

  it('throws, naming the station, when there is nothing to frame', () => {
    expect(() => interiorBounds({ ...interior, platforms: [], slabs: [], entrances: [] })).toThrow(
      'Station interior X01 has no outlines or entrances',
    )
  })
})

describe('interiorFocusTarget', () => {
  it('centers the plan and shifts south by the scaled mid-depth times tan(polar)', () => {
    const t = interiorFocusTarget({ x: 100, z: 200 }, interior, 2, Math.SQRT2)
    expect(t.x).toBeCloseTo(100 + 5)
    expect(t.z).toBeCloseTo(200 + 8.5 + 8 * Math.SQRT2)
  })
})

describe('formatDepth', () => {
  it('uses a true minus and one decimal', () => {
    expect(formatDepth(-4.3)).toBe('−4.3 m')
    expect(formatDepth(-9.06)).toBe('−9.1 m')
    expect(formatDepth(0)).toBe('0.0 m')
    expect(formatDepth(-0.01)).toBe('0.0 m')
  })
})

describe('levelLabels', () => {
  it('labels each below-street level under the middle of its south edge, at scaled height', () => {
    expect(levelLabels(interior, 2)).toEqual([
      { levelId: 'mezz', text: 'Mezzanine −4.0 m', position: [0, -8, 17] },
      { levelId: 'plat', text: 'Platform −8.0 m', position: [0, -16, 5] },
    ])
  })

  it('prefers the long south-facing side of a diagonal outline over its short south-east end', () => {
    // A long thin outline running north-west to south-east, any winding.
    const outline: LocalPoint[] = [
      [-50, -46],
      [-46, -50],
      [50, 46],
      [46, 50],
    ]
    const level = { ...interior, slabs: [], platforms: [{ ...interior.platforms[0]!, outline }] }
    const [x, , z] = levelLabels(level, 1, 0)[0]!.position
    expect(x).toBeCloseTo(-2)
    expect(z).toBeCloseTo(2)
  })

  it('uses the westmost outline when a level has several', () => {
    const east: LocalPoint[] = [
      [40, 0],
      [50, 0],
      [50, 10],
      [40, 10],
    ]
    const slabs = [...interior.slabs, { ...interior.slabs[0]!, id: 'S2', outline: east }]
    expect(levelLabels({ ...interior, slabs }, 1, 0)[0]!.position[0]).toBe(0)
  })

  it('skips levels without outlines', () => {
    expect(levelLabels({ ...interior, slabs: [] }, 1).map((l) => l.levelId)).toEqual(['plat'])
  })
})

describe('paddedHull', () => {
  const square: LocalPoint[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]

  it('drops interior and collinear points', () => {
    const hull = paddedHull([...square, [5, 5], [5, 0], [10, 5]], 0)
    expect(hull).toHaveLength(4)
    expect(hull.map(([x, z]) => `${x},${z}`).sort()).toEqual(['0,0', '0,10', '10,0', '10,10'])
  })

  it('pushes each vertex pad meters farther from the centroid', () => {
    for (const [x, z] of paddedHull(square, 3)) {
      expect(Math.hypot(x - 5, z - 5)).toBeCloseTo(Math.hypot(5, 5) + 3)
    }
  })
})
