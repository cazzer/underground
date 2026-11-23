import { describe, expect, it } from 'vitest'
import { TRIP_MARK_HALO } from '../scene/markerShape'
import { CHANGE_MARK_SHARE, FOCUS_OUTSIDE_INNER, START_GROWTH_CAP, startRadiusNearFix, tripMarkRadius } from './tripMarkSize'

const pos = { x: 100, z: 100 }
const reticle = { outerM: 15, gapM: 2 }
const at = (dx: number) => ({ x: pos.x + dx, z: pos.z })

describe('tripMarkRadius', () => {
  it('draws a change smaller than the start and end, and grows only the start round the reticle', () => {
    expect(tripMarkRadius('end', 10, pos, pos, reticle)).toBe(10)
    expect(tripMarkRadius('change', 10, pos, pos, reticle)).toBeCloseTo(10 * CHANGE_MARK_SHARE)
    expect(tripMarkRadius('start', 10, pos, null, reticle)).toBe(10)
    expect(tripMarkRadius('start', 10, pos, pos, reticle)).toBe(startRadiusNearFix(10, pos, pos, reticle))
    expect(CHANGE_MARK_SHARE).toBeLessThan(1)
  })
})

describe('startRadiusNearFix', () => {
  it('ends the ring the gap outside the reticle with the fix on the mark', () => {
    expect(startRadiusNearFix(10, pos, pos, reticle)).toBe(17)
    // Offset 5: the reticle's far edge is 20 m out.
    expect(startRadiusNearFix(10, pos, at(5), reticle)).toBe(22)
  })

  it('caps the growth at START_GROWTH_CAP times the radius', () => {
    expect(startRadiusNearFix(10, pos, at(9), reticle)).toBe(10 * START_GROWTH_CAP)
    expect(startRadiusNearFix(4, pos, pos, reticle)).toBe(4 * START_GROWTH_CAP)
  })

  it('grows from nothing as the reticle first touches the ring, without a jump', () => {
    // radius 10 + reticle 15: the reticle touches the ring at offset 25.
    expect(startRadiusNearFix(10, pos, at(25), reticle)).toBe(10)
    expect(startRadiusNearFix(10, pos, at(24.99), reticle)).toBeCloseTo(10, 1)
    let last = startRadiusNearFix(10, pos, at(25), reticle)
    for (let dx = 24; dx >= 10; dx--) {
      const r = startRadiusNearFix(10, pos, at(dx), reticle)
      expect(r).toBeGreaterThanOrEqual(last)
      last = r
    }
  })

  it('never shrinks the mark, and leaves it alone with no fix or the reticle clear of it', () => {
    expect(startRadiusNearFix(30, pos, pos, reticle)).toBe(30)
    expect(startRadiusNearFix(10, pos, at(26), reticle)).toBe(10)
    expect(startRadiusNearFix(10, pos, null, reticle)).toBe(10)
  })
})

describe('focus ring outside a mark', () => {
  it("starts outside the mark's background halo", () => {
    expect(FOCUS_OUTSIDE_INNER).toBeGreaterThan(TRIP_MARK_HALO)
  })
})
