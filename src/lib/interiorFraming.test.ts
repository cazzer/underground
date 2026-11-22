import { describe, expect, it } from 'vitest'
import type { Level, LocalPoint, StationInterior } from '../data/stationSchema'
import { formatDepth, interiorBounds, interiorFocusAnchor, levelHeightText, levelLabels, paddedHull } from './interiorFraming'

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

describe('interiorFocusAnchor', () => {
  it('centers the plan, gives the scaled mid-depth times tan(polar) toward the camera and the farthest point', () => {
    const a = interiorFocusAnchor({ x: 100, z: 200 }, interior, 2, Math.SQRT2)
    expect(a.center.x).toBeCloseTo(100 + 5)
    expect(a.center.z).toBeCloseTo(200 + 8.5)
    expect(a.towardCamera).toBeCloseTo(8 * Math.SQRT2)
    // A corner and the entrance tie at (±25, 11.5) from the center: past the 25 m half of the longer side.
    expect(a.reach).toBeCloseTo(Math.hypot(25, 11.5))
  })
  it('aims at mid-height between the lowest and highest level, away from the camera above the street', () => {
    const elevated = { ...interior, levels: [{ id: 'plat', name: 'Platform', kind: 'platform', y: 8 }, { id: 'street', name: 'Street', kind: 'street', y: 0 }] } satisfies StationInterior
    expect(interiorFocusAnchor({ x: 0, z: 0 }, elevated, 2, Math.SQRT2).towardCamera).toBeCloseTo(-8 * Math.SQRT2)
    const both = { ...interior, levels: [{ id: 'plat', name: 'Platform', kind: 'platform', y: 6 }, { id: 'street', name: 'Street', kind: 'street', y: 0 }, { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: -2 }] } satisfies StationInterior
    expect(interiorFocusAnchor({ x: 0, z: 0 }, both, 1, 1).towardCamera).toBeCloseTo(-2)
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

describe('levelHeightText', () => {
  const level = (y: number, depthSource?: Level['depthSource']): Level => ({ id: 'l', name: 'L', kind: 'platform', y, depthSource })

  it('keeps formatDepth for authored levels, elevated ones included', () => {
    expect(levelHeightText(level(-4.3), false)).toBe('−4.3 m')
    expect(levelHeightText(level(6.2), false)).toBe('6.2 m')
  })

  it('applies the depthSource rule to an authored level that states one', () => {
    expect(levelHeightText(level(-3.82, 'ee-rise'), false)).toBe('−3.8 m')
    expect(levelHeightText(level(-6.9, 'osm-level'), false)).toBe('≈ −7 m')
    expect(levelHeightText(level(-6.9), false)).toBe('−6.9 m')
  })

  it('signs a measured (ee-rise) depth to one decimal', () => {
    expect(levelHeightText(level(-9.06, 'ee-rise'), true)).toBe('−9.1 m')
    expect(levelHeightText(level(6.2, 'ee-rise'), true)).toBe('+6.2 m')
    expect(levelHeightText(level(-0.01, 'ee-rise'), true)).toBe('0.0 m')
  })

  it('marks every other generated depth as an estimate in whole meters', () => {
    expect(levelHeightText(level(-9.4, 'structure-default'), true)).toBe('≈ −9 m')
    expect(levelHeightText(level(-30.6, 'deep-list'), true)).toBe('≈ −31 m')
    expect(levelHeightText(level(7.5, 'osm-level'), true)).toBe('≈ +8 m')
    expect(levelHeightText(level(-5), true)).toBe('≈ −5 m')
    expect(levelHeightText(level(-0.3, 'structure-default'), true)).toBe('≈ 0 m')
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

  it('finds the same edge for either winding', () => {
    const reversed = { ...interior, platforms: [{ ...interior.platforms[0]!, outline: [...interior.platforms[0]!.outline].reverse() }] }
    expect(levelLabels(reversed, 2)).toEqual(levelLabels(interior, 2))
    expect(levelLabels(reversed, 2)[1]!.position).toEqual([0, -16, 5])
  })

  it('takes the outward side from the winding, not the centroid, for a concave outline', () => {
    // A U open to the south. The notch's top edge faces south into open space, but the vertex
    // centroid lies south of it, so a centroid test would point its normal north.
    const u: LocalPoint[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [8, 10],
      [8, 2],
      [2, 2],
      [2, 10],
      [0, 10],
    ]
    for (const outline of [u, [...u].reverse()]) {
      const level = { ...interior, slabs: [], platforms: [{ ...interior.platforms[0]!, outline }] }
      const [x, , z] = levelLabels(level, 1, 1)[0]!.position
      expect(x).toBeCloseTo(5)
      expect(z).toBeCloseTo(3)
    }
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

  it('marks a generated interior\'s estimated depths', () => {
    const levels = interior.levels.map((l) => (l.kind === 'street' ? l : { ...l, depthSource: 'structure-default' as const }))
    const generated = { ...interior, levels, generated: { archetype: 'cut-cover-mezzanine' as const, confidence: 0.8 } }
    expect(levelLabels(generated, 2).map((l) => l.text)).toEqual(['Mezzanine ≈ −4 m', 'Platform ≈ −8 m'])
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
