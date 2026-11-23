import { describe, expect, it } from 'vitest'
import { TRIP_MARK_HALO } from '../scene/markerShape'
import { CHANGE_MARK_SHARE, FOCUS_OUTSIDE_INNER, markRadius, startRadiusNearFix } from './tripMarkSize'

describe('markRadius', () => {
  it('draws a change smaller than the start and end', () => {
    expect(markRadius('start', 10)).toBe(10)
    expect(markRadius('end', 10)).toBe(10)
    expect(markRadius('change', 10)).toBeCloseTo(10 * CHANGE_MARK_SHARE)
    expect(CHANGE_MARK_SHARE).toBeLessThan(1)
  })
})

describe('startRadiusNearFix', () => {
  const pos = { x: 100, z: 100 }

  it('grows the mark past the reticle when the fix lies on it', () => {
    expect(startRadiusNearFix(10, pos, { x: 105, z: 100 }, 15, 2)).toBe(17)
    expect(startRadiusNearFix(10, pos, pos, 15, 2)).toBe(17)
  })

  it('never shrinks it, and leaves it alone with the fix off the mark or no fix', () => {
    expect(startRadiusNearFix(30, pos, pos, 15, 2)).toBe(30)
    expect(startRadiusNearFix(10, pos, { x: 111, z: 100 }, 15, 2)).toBe(10)
    expect(startRadiusNearFix(10, pos, null, 15, 2)).toBe(10)
  })
})

describe('focus ring outside a mark', () => {
  it("starts outside the mark's background halo", () => {
    expect(FOCUS_OUTSIDE_INNER).toBeGreaterThan(TRIP_MARK_HALO)
  })
})
