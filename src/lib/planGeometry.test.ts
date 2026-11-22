import { describe, expect, it } from 'vitest'
import type { LocalPoint } from '../data/stationSchema'
import { distanceToRing, nearestOnPolyline, segmentT, slicePolyline } from './planGeometry'

// A concave L: a 10 x 10 square with its top-right 5 x 5 corner cut away.
const L: LocalPoint[] = [
  [0, 0],
  [10, 0],
  [10, 5],
  [5, 5],
  [5, 10],
  [0, 10],
]

describe('distanceToRing', () => {
  for (const [name, ring] of [['counter-clockwise', L], ['clockwise', [...L].reverse()]] as const) {
    it(`is 0 inside and on an edge, and the distance outside, for a ${name} concave L`, () => {
      expect(distanceToRing([2, 2], ring)).toBe(0)
      expect(distanceToRing([2, 8], ring)).toBe(0)
      expect(distanceToRing([10, 3], ring)).toBe(0)
      expect(distanceToRing([12, 3], ring)).toBeCloseTo(2, 12)
      // In the notch: 2 m from the inner edges.
      expect(distanceToRing([7, 7], ring)).toBeCloseTo(2, 12)
    })
  }
})

describe('segmentT', () => {
  it('clamps to the segment, and is 0 for a zero-length one', () => {
    expect(segmentT([-5, 1], [0, 0], [10, 0])).toBe(0)
    expect(segmentT([15, 1], [0, 0], [10, 0])).toBe(1)
    expect(segmentT([4, 1], [0, 0], [10, 0])).toBeCloseTo(0.4, 12)
    expect(segmentT([4, 1], [3, 3], [3, 3])).toBe(0)
  })
})

describe('nearestOnPolyline', () => {
  const line: LocalPoint[] = [
    [0, 0],
    [10, 0],
    [10, 10],
  ]
  it('finds the point mid-segment with its distance along', () => {
    const hit = nearestOnPolyline(line, [12, 4])
    expect(hit.point).toEqual([10, 4])
    expect(hit.along).toBeCloseTo(14, 12)
    expect(hit.distance).toBeCloseTo(2, 12)
    expect(hit.total).toBe(20)
  })
  it('survives a zero-length segment and a single point', () => {
    const hit = nearestOnPolyline([[0, 0], [5, 0], [5, 0], [5, 5]], [6, 1])
    expect(hit.point).toEqual([5, 1])
    expect(hit.along).toBeCloseTo(6, 12)
    expect(nearestOnPolyline([[3, 4]], [0, 0])).toMatchObject({ point: [3, 4], along: 0, distance: 5, total: 0 })
  })
})

describe('slicePolyline', () => {
  const line: LocalPoint[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]
  it('cuts forward, keeping the vertices between', () => {
    expect(slicePolyline(line, 4, 24)).toEqual([[4, 0], [10, 0], [10, 10], [6, 10]])
  })
  it('cuts backward, in travel order', () => {
    expect(slicePolyline(line, 24, 4)).toEqual([[6, 10], [10, 10], [10, 0], [4, 0]])
  })
  it('stays on one segment, drops repeats at a vertex and clamps', () => {
    expect(slicePolyline(line, 2, 7)).toEqual([[2, 0], [7, 0]])
    expect(slicePolyline(line, 10, 15)).toEqual([[10, 0], [10, 5]])
    expect(slicePolyline(line, 3, 3)).toEqual([[3, 0]])
    expect(slicePolyline(line, -5, 100)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
  })
})
