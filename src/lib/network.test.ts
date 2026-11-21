import { describe, expect, it } from 'vitest'
import { pointAlong, type Route } from './network'

function route(points: { x: number; z: number }[]): Route {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  return { id: 'r', name: 'r', colorIndex: 0, points, cumulative, length: cumulative.at(-1) ?? 0 }
}

describe('pointAlong', () => {
  it('returns the only point of a one-point route', () => {
    expect(pointAlong(route([{ x: 3, z: 4 }]), 10)).toEqual({ x: 3, z: 4 })
  })

  it('throws for a route without points', () => {
    expect(() => pointAlong(route([]), 0)).toThrow()
  })

  it('interpolates to the midpoint of a two-point route', () => {
    expect(pointAlong(route([{ x: 0, z: 0 }, { x: 10, z: 20 }]), Math.hypot(10, 20) / 2)).toEqual({ x: 5, z: 10 })
  })

  it('writes into the provided out object', () => {
    const out = { x: 0, z: 0 }
    expect(pointAlong(route([{ x: 0, z: 0 }, { x: 10, z: 0 }]), 4, out)).toBe(out)
    expect(out).toEqual({ x: 4, z: 0 })
  })
})
