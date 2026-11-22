import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../data/schema'
import { toGround } from '../projection'
import { convexHull, HULL_MAX_EDGES, hullOutside, isNoOutline, networkHull, UNUSED_EDGE } from './networkHull'

const square = [
  { x: 0, z: 0 },
  { x: 100, z: 0 },
  { x: 100, z: 100 },
  { x: 0, z: 100 },
  { x: 50, z: 50 },
  { x: 50, z: 0 },
]

describe('convexHull', () => {
  it('keeps the corners only, no inner or collinear points', () => {
    const hull = convexHull(square)
    expect(hull).toHaveLength(4)
    expect(new Set(hull.map((p) => `${p.x},${p.z}`))).toEqual(new Set(['0,0', '100,0', '100,100', '0,100']))
  })
})

describe('networkHull', () => {
  it('gives one outward half-plane per hull edge', () => {
    const edges = networkHull(square)
    expect(edges).toHaveLength(4)
    expect(isNoOutline(edges)).toBe(false)
    expect(hullOutside(50, 50, edges)).toBeCloseTo(-50, 9)
    expect(hullOutside(130, 50, edges)).toBeCloseTo(30, 9)
    expect(hullOutside(50, -20, edges)).toBeCloseTo(20, 9)
    // Off a corner it is the distance to the nearer edge line (a sharp padded corner).
    expect(hullOutside(110, 120, edges)).toBeCloseTo(20, 9)
  })

  it('cuts the smallest corners of a hull with too many vertices', () => {
    const circle = Array.from({ length: 100 }, (_, i) => ({ x: 1000 * Math.cos((i / 100) * 2 * Math.PI), z: 1000 * Math.sin((i / 100) * 2 * Math.PI) }))
    const edges = networkHull(circle)
    expect(edges).toHaveLength(HULL_MAX_EDGES)
    // Every dropped point lies just outside the cut: a few meters at most here, and the pad covers it.
    for (const p of circle) expect(hullOutside(p.x, p.z, edges)).toBeLessThan(20)
  })

  it('gives one edge nothing is outside of for points that span no area', () => {
    const edges = networkHull([{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }])
    expect(edges).toEqual([UNUSED_EDGE])
    expect(isNoOutline(edges)).toBe(true)
    expect(hullOutside(1e5, -1e5, edges)).toBeLessThan(-1e8)
  })

  it('outlines every station of the real network within a few meters', () => {
    const stations = (JSON.parse(readFileSync('public/data/stations.json', 'utf8')) as StationsFile).stations
    const points = stations.map((s) => toGround({ lat: s.lat, lon: s.lon }))
    const edges = networkHull(points)
    for (const [i, p] of points.entries()) expect(hullOutside(p.x, p.z, edges), stations[i]!.id).toBeLessThan(1)
  })
})
