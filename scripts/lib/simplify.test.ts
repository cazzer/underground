import { describe, expect, it } from 'vitest'
import { simplifyIndices } from './simplify.ts'

const line = (zs: number[]) => zs.map((z, i) => ({ x: i * 100, z }))

describe('simplifyIndices', () => {
  it('returns all indices for fewer than 3 points', () => {
    expect(simplifyIndices([], 3)).toEqual([])
    expect(simplifyIndices(line([0]), 3)).toEqual([0])
    expect(simplifyIndices(line([0, 9]), 3)).toEqual([0, 1])
  })
  it('reduces collinear points to the endpoints', () => {
    expect(simplifyIndices(line([0, 0, 0, 0, 0]), 3)).toEqual([0, 4])
  })
  it('keeps a point 5 m off the line at tolerance 3 and drops it at 10', () => {
    expect(simplifyIndices(line([0, 5, 0]), 3)).toEqual([0, 1, 2])
    expect(simplifyIndices(line([0, 5, 0]), 10)).toEqual([0, 2])
  })
  it('keeps both ends and returns ascending indices', () => {
    const out = simplifyIndices(line([0, 40, -30, 20, 0, 60, 0]), 3)
    expect(out[0]).toBe(0)
    expect(out.at(-1)).toBe(6)
    expect(out).toEqual([...out].sort((a, b) => a - b))
  })
  it('does not produce NaN for duplicate consecutive points', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ]
    expect(simplifyIndices(pts, 3)).toEqual([0, 2])
    const loop = [
      { x: 0, z: 0 },
      { x: 50, z: 50 },
      { x: 0, z: 0 },
    ]
    expect(simplifyIndices(loop, 3)).toEqual([0, 1, 2])
  })
  it('keeps the corner of an L shape', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 200, z: 0 },
      { x: 200, z: 100 },
      { x: 200, z: 200 },
    ]
    expect(simplifyIndices(pts, 3)).toEqual([0, 2, 4])
  })
})
