import { describe, expect, it } from 'vitest'
import { complexPanRadius, nearestPoint, PAN_MARGIN, PAN_RADIUS_BARE, PAN_RADIUS_MAX } from './orbitLimits'

describe('complexPanRadius', () => {
  it('is the bare radius for a lone station and for members close enough that their discs already overlap', () => {
    expect(complexPanRadius([{ x: 5, z: 5 }])).toBe(PAN_RADIUS_BARE)
    expect(complexPanRadius([{ x: 0, z: 0 }, { x: 150, z: 0 }])).toBe(PAN_RADIUS_BARE)
  })

  it("is half the members' longest joining edge plus the margin, along the shortest tree, not the widest pair", () => {
    // A row of three 220 m apart: the tree's edges are 220 m, though the ends are 440 m apart.
    const row = [{ x: 0, z: 0 }, { x: 440, z: 0 }, { x: 220, z: 0 }]
    expect(complexPanRadius(row)).toBe(110 + PAN_MARGIN)
    expect(complexPanRadius([{ x: 0, z: 0 }, { x: 0, z: 266 }])).toBe(133 + PAN_MARGIN)
  })

  it('is capped at the largest pan radius', () => {
    expect(complexPanRadius([{ x: 0, z: 0 }, { x: 1000, z: 0 }])).toBe(PAN_RADIUS_MAX)
  })
})

describe('nearestPoint', () => {
  it('returns the nearest of the points itself, the first on a tie', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 50, z: 50 }]
    expect(nearestPoint({ x: 90, z: 10 }, pts)).toBe(pts[1])
    expect(nearestPoint({ x: 50, z: 0 }, pts)).toBe(pts[0])
    expect(nearestPoint({ x: 50, z: 40 }, pts)).toBe(pts[2])
  })
})
