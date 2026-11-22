import { describe, expect, it } from 'vitest'
import { keepRing, ringArea } from './areaFilter'

describe('ringArea', () => {
  it('is the absolute shoelace area, closed or not, either winding', () => {
    const square = [0, 0, 100, 0, 100, 100, 0, 100]
    expect(ringArea(square)).toBe(10_000)
    expect(ringArea([...square, 0, 0])).toBe(10_000)
    expect(ringArea([0, 0, 0, 100, 100, 100, 100, 0])).toBe(10_000)
    expect(ringArea([0, 0, 10, 0])).toBe(0)
  })
})

describe('keepRing', () => {
  it('drops rings under 1 ha before z14 and under 5 ha before z13', () => {
    expect(keepRing(9_000, 13, false)).toBe(false)
    expect(keepRing(9_000, 14, false)).toBe(true)
    expect(keepRing(30_000, 12, false)).toBe(false)
    expect(keepRing(30_000, 13, false)).toBe(true)
    expect(keepRing(50_000, 9, false)).toBe(true)
  })

  it('keeps any ring that reaches the tile edge', () => {
    expect(keepRing(10, 9, true)).toBe(true)
  })
})
