import { describe, expect, it } from 'vitest'
import { groundX, groundZ } from '../projection'
import { EDGE_FADE_M, edgeAlpha, sceneBox } from './edgeFade'

const BBOX = [-74.2591, 40.4774, -73.7004, 40.9176] as const

describe('sceneBox', () => {
  it('puts west and north at the low x and z (x east, z south)', () => {
    const box = sceneBox(BBOX)
    expect(box.minX).toBe(groundX(BBOX[0]))
    expect(box.maxX).toBe(groundX(BBOX[2]))
    expect(box.minZ).toBe(groundZ(BBOX[3]))
    expect(box.maxZ).toBe(groundZ(BBOX[1]))
    expect(box.minX).toBeLessThan(box.maxX)
    expect(box.minZ).toBeLessThan(box.maxZ)
  })
})

describe('edgeAlpha', () => {
  const box = { minX: 0, maxX: 40_000, minZ: 0, maxZ: 50_000 }

  it('is 1 well inside, 0 at and outside every edge', () => {
    expect(edgeAlpha(20_000, 25_000, box)).toBe(1)
    expect(edgeAlpha(EDGE_FADE_M, 25_000, box)).toBe(1)
    for (const [x, z] of [[0, 25_000], [40_000, 25_000], [20_000, 0], [20_000, 50_000], [-10, 25_000], [20_000, 60_000]]) {
      expect(edgeAlpha(x!, z!, box), `${x},${z}`).toBe(0)
    }
  })

  it('eases in by the nearest edge, halfway at half the fade', () => {
    expect(edgeAlpha(EDGE_FADE_M / 2, 25_000, box)).toBeCloseTo(0.5, 12)
    expect(edgeAlpha(20_000, 50_000 - EDGE_FADE_M / 2, box)).toBeCloseTo(0.5, 12)
    // A corner takes the nearer edge.
    expect(edgeAlpha(EDGE_FADE_M / 2, 100, box)).toBe(edgeAlpha(100, 25_000, box))
    let prev = 0
    for (let x = 0; x <= EDGE_FADE_M; x += 100) {
      const a = edgeAlpha(x, 25_000, box)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })
})
