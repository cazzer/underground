import { describe, expect, it } from 'vitest'
import { buildPolyline, pointAtDistance, projectForward } from './polyline'

const north = buildPolyline([{ x: 0, z: 0 }, { x: 0, z: -1000 }, { x: 0, z: -2000 }])

describe('buildPolyline', () => {
  it('accumulates segment lengths', () => {
    const line = buildPolyline([{ x: 0, z: 0 }, { x: 3, z: 4 }, { x: 3, z: 14 }])
    expect(line.cumulative).toEqual([0, 5, 15])
    expect(line.length).toBe(15)
  })
})

describe('pointAtDistance', () => {
  it('interpolates and clamps', () => {
    expect(pointAtDistance(north, 500).point).toEqual({ x: 0, z: -500 })
    expect(pointAtDistance(north, 1750).point).toEqual({ x: 0, z: -1750 })
    expect(pointAtDistance(north, -5).point).toEqual({ x: 0, z: 0 })
    expect(pointAtDistance(north, 9999).point).toEqual({ x: 0, z: -2000 })
  })
  it('reports heading clockwise from north', () => {
    expect(pointAtDistance(north, 500).heading).toBeCloseTo(0)
    expect(pointAtDistance(buildPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }]), 5).heading).toBeCloseTo(Math.PI / 2)
    expect(pointAtDistance(buildPolyline([{ x: 0, z: 0 }, { x: 0, z: 10 }]), 5).heading).toBeCloseTo(Math.PI)
  })
  it('survives duplicate points', () => {
    const line = buildPolyline([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: -10 }])
    for (const d of [0, 5, 10]) {
      const { point, heading } = pointAtDistance(line, d)
      expect(Number.isFinite(point.x) && Number.isFinite(point.z) && Number.isFinite(heading)).toBe(true)
    }
    expect(pointAtDistance(line, 5).point).toEqual({ x: 0, z: -5 })
  })
  it('handles a single-point line', () => {
    expect(pointAtDistance(buildPolyline([{ x: 1, z: 2 }]), 7)).toEqual({ point: { x: 1, z: 2 }, heading: 0 })
  })
})

describe('projectForward', () => {
  it('finds the closest point and the perpendicular offset', () => {
    const r = projectForward(north, { x: 30, z: -1400 }, { segment: 0, t: 0 })
    expect(r.distance).toBeCloseTo(1400)
    expect(r.offsetM).toBeCloseTo(30)
    expect(r.segment).toBe(1)
  })
  it('never returns a point before the cursor', () => {
    const r = projectForward(north, { x: 0, z: -100 }, { segment: 1, t: 0.5 })
    expect(r.distance).toBeCloseTo(1500)
  })
  it('breaks ties toward the earliest segment', () => {
    const bend = buildPolyline([{ x: 0, z: 0 }, { x: 0, z: -100 }, { x: 10, z: -100 }])
    expect(projectForward(bend, { x: 0, z: -100 }, { segment: 0, t: 0 }).segment).toBe(0)
  })
})
