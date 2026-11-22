import { describe, expect, it } from 'vitest'
import { fixture } from './interiorFixture'
import { outlineSamples } from './interiorOutline'

const triples = (a: Float32Array) => Array.from({ length: a.length / 3 }, (_, i) => [a[3 * i]!, a[3 * i + 1]!, a[3 * i + 2]!])

describe('outlineSamples', () => {
  it('walks each closed outline every 4 m at its level, × yScale, and each slab’s at the street', () => {
    const pts = triples(outlineSamples(fixture(), 2))
    // The platform's 92 m ring gives 23 points at y = -8 × 2, the slab's 40 m ring 10 at -4 × 2.
    expect(pts.filter((p) => p[1] === -16)).toHaveLength(23)
    expect(pts.filter((p) => p[1] === -8)).toHaveLength(10)
    // Evenly spaced round the corner: the platform ring starts at (-20, -3), then 4 m east.
    expect(pts[0]).toEqual([-20, -16, -3])
    expect(pts[1]).toEqual([-16, -16, -3])
    // The slab's street-level copy, last, closes back toward its first corner along x = -5.
    expect(pts.filter((p) => p[1] === 0)).toHaveLength(10)
    expect(pts.at(-1)![0]).toBe(-5)
  })

  it('stretches its spacing to stay within the cap', () => {
    const pts = outlineSamples(fixture(), 1, 12)
    expect(pts.length / 3).toBeLessThanOrEqual(12)
    expect(pts.length / 3).toBeGreaterThanOrEqual(10)
  })
})
