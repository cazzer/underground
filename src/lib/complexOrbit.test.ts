import { describe, expect, it } from 'vitest'
import {
  clampToDiscs,
  complexPanRadius,
  insideDiscs,
  nearestPoint,
  PAN_GIVE,
  PAN_MARGIN,
  PAN_RADIUS_BARE,
  PAN_RADIUS_MAX,
  softClampToRadius,
} from './orbitLimits'
import type { Ground } from './projection'

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

describe('clampToDiscs', () => {
  // Two members 300 m apart with 100 m discs: a seam of 100 m between them along z = 0.
  const a = { x: 0, z: 0 }
  const b = { x: 300, z: 0 }
  const centers = [a, b]
  const R = 100
  const gap = (p: Ground, c: Ground) => Math.hypot(p.x - c.x, p.z - c.z)

  it('leaves a point inside any disc alone, and tells inside from the seam', () => {
    const out = { x: 0, z: 0 }
    for (const p of [{ x: 60, z: 70 }, { x: 290, z: -90 }]) {
      expect(insideDiscs(p, centers, R)).toBe(true)
      expect(clampToDiscs(p, centers, R, 1 / 60, out)).toBe(false)
      expect(out).toEqual(p)
    }
    expect(insideDiscs({ x: 150, z: 0 }, centers, R)).toBe(false)
  })

  it("is the nearest center's own soft clamp, so a single center is exactly softClampToRadius", () => {
    const p = { x: 140, z: 30 }
    const [one, two] = [{ x: 0, z: 0 }, { x: 0, z: 0 }]
    expect(clampToDiscs(p, centers, R, 1 / 60, one)).toBe(true)
    softClampToRadius(p, a, R, 1 / 60, two)
    expect(one).toEqual(two)
    expect(clampToDiscs(p, [b], R, 1 / 60, one)).toBe(true)
    softClampToRadius(p, b, R, 1 / 60, two)
    expect(one).toEqual(two)
  })

  it('eases a point in the seam onto the nearest disc along its radius, never flipping to the other center', () => {
    // Just nearer a, inside the give: the spring pulls it along a's ray, frame after frame.
    for (const start of [{ x: 120, z: 8 }, { x: 149, z: 2 }, { x: 125, z: -15 }]) {
      const p = { ...start }
      const out = { x: 0, z: 0 }
      const bearing = Math.atan2(p.z - a.z, p.x - a.x)
      for (let frame = 0; frame < 240; frame++) {
        expect(nearestPoint(p, centers)).toBe(a)
        if (!clampToDiscs(p, centers, R, 1 / 60, out)) break
        expect(gap(out, a)).toBeLessThanOrEqual(gap(p, a) + 1e-9)
        expect(Math.atan2(out.z - a.z, out.x - a.x)).toBeCloseTo(bearing, 9)
        p.x = out.x
        p.z = out.z
      }
      expect(gap(p, a)).toBeLessThanOrEqual(R + 1e-3)
    }
  })

  it('on the exact middle of the seam takes the first center, every frame', () => {
    const p = { x: 150, z: 0 }
    const out = { x: 0, z: 0 }
    for (let frame = 0; frame < 120 && clampToDiscs(p, centers, R, 1 / 60, out); frame++) {
      expect(out.x).toBeLessThan(p.x)
      expect(out.z).toBe(0)
      p.x = out.x
    }
    expect(p.x).toBeLessThanOrEqual(R + PAN_GIVE)
    expect(gap(p, a)).toBeLessThanOrEqual(R + 1e-3)
  })
})
