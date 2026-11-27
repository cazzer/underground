import { describe, expect, it } from 'vitest'
import type { Rgb } from './lineBuffers'
import { tripDashBuffers } from './tripDashBuffers'
import type { RideStraightSpan, WalkSpan } from './tripSpans'

const PINK: Rgb = [1, 0.1, 0.5]
const GREEN: Rgb = [0, 0.6, 0.2]
const walk = (x0: number, x1: number): WalkSpan => ({
  kind: 'walk',
  legIndex: 1,
  fromStationId: 'A',
  toStationId: 'B',
  sameComplex: false,
  from: { x: x0, z: 0 },
  to: { x: x1, z: 0 },
})
const straight = (routeId: string, points: RideStraightSpan['points']): RideStraightSpan => ({ kind: 'straight', legIndex: 0, routeId, points })
const colorOf = (s: RideStraightSpan): Rgb | null => (s.routeId === 'G' ? GREEN : null)
const near = (a: Float32Array, b: number[]) => {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 4))
}

describe('tripDashBuffers', () => {
  it('draws a walk as one ground segment from 0 to its length, in the walk color', () => {
    const b = tripDashBuffers([walk(0, 30)], [], PINK, colorOf)
    near(b.positions, [0, 0, 0, 30, 0, 0])
    near(b.colors, [...PINK, ...PINK])
    near(b.distances, [0, 30])
  })

  it('draws a walk with a street path as one segment per leg of it, distances accumulating from 0', () => {
    const streets: WalkSpan = { ...walk(0, 30), path: [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 40 }] }
    const b = tripDashBuffers([streets, walk(50, 70)], [], PINK, colorOf)
    near(b.positions, [0, 0, 0, 30, 0, 0, 30, 0, 0, 30, 0, 40, 50, 0, 0, 70, 0, 0])
    near(b.distances, [0, 30, 30, 70, 0, 20])
    near(b.colors.subarray(0, 3), [...PINK])
  })

  it('draws a straight ride through its stops with cumulative distances, in its route color', () => {
    const b = tripDashBuffers([], [straight('G', [{ x: 0, z: 0 }, { x: 3, z: 4 }, { x: 3, z: 14 }])], PINK, colorOf)
    near(b.positions, [0, 0, 0, 3, 0, 4, 3, 0, 4, 3, 0, 14])
    near(b.distances, [0, 5, 5, 15])
    near(b.colors.subarray(0, 3), [...GREEN])
  })

  it('restarts every polyline at distance 0, walks first', () => {
    const b = tripDashBuffers([walk(0, 10), walk(50, 70)], [straight('G', [{ x: 0, z: 0 }, { x: 0, z: 8 }])], PINK, colorOf)
    near(b.distances, [0, 10, 0, 20, 0, 8])
    near(b.colors.subarray(12, 15), [...GREEN])
  })

  it('leaves out a straight ride with no color, and is empty with nothing to draw', () => {
    const b = tripDashBuffers([], [straight('Z', [{ x: 0, z: 0 }, { x: 0, z: 8 }])], PINK, colorOf)
    expect(b.positions.length).toBe(0)
    expect(tripDashBuffers([], [], PINK, colorOf).distances.length).toBe(0)
  })
})
