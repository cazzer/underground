import { describe, expect, it } from 'vitest'
import { toGround } from '../../src/lib/projection.ts'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { distanceToRing, makeFrame, openRing, roundM } from './stationGeometry.ts'

const anchor = { lat: 40.7, lon: -74 }

describe('makeFrame.fromUV', () => {
  it('maps [u, v] along and right of the bearing to [x east, z south]', () => {
    expect(makeFrame({ anchor, bearingDeg: 90 }).fromUV([10, 2])).toEqual([10, 2])
    expect(makeFrame({ anchor, bearingDeg: 0 }).fromUV([10, 2])).toEqual([2, -10])
    expect(makeFrame({ anchor, bearingDeg: 180 }).fromUV([10, 2])).toEqual([-2, 10])
  })
  it('never returns -0', () => {
    const [x, z] = makeFrame({ anchor, bearingDeg: 0 }).fromUV([0, 0])
    expect(Object.is(x, -0) || Object.is(z, -0)).toBe(false)
  })
})

describe('makeFrame.fromLatLon', () => {
  const frame = makeFrame({ anchor, bearingDeg: 0 })
  it('puts the anchor at the origin', () => {
    expect(frame.fromLatLon(anchor.lat, anchor.lon)).toEqual([0, 0])
  })
  it('puts a point 100 m north at z = -100, agreeing with toGround', () => {
    const north = { lat: anchor.lat + 100 / 111_194.9266, lon: anchor.lon }
    const [x, z] = frame.fromLatLon(north.lat, north.lon)
    expect(x).toBe(0)
    expect(z).toBeCloseTo(-100, 1)
    expect([x, z]).toEqual([roundM(toGround(north, anchor).x), roundM(toGround(north, anchor).z)])
  })
})

describe('roundM', () => {
  it('rounds to 2 decimals', () => {
    expect(roundM(1.2345)).toBe(1.23)
    expect(roundM(-0.004)).toBe(0)
  })
})

describe('openRing', () => {
  const sq: LocalPoint[] = [[0, 0], [4, 0], [4, 4], [0, 4]]
  it('drops the closing duplicate and leaves an open ring alone', () => {
    expect(openRing([...sq, [0, 0]], 'sq')).toEqual(sq)
    expect(openRing(sq, 'sq')).toEqual(sq)
  })
  it('throws below 3 points', () => {
    expect(() => openRing([[0, 0], [1, 1], [0, 0]], 'tri')).toThrow(/tri.*at least 3/)
  })
})

describe('distanceToRing', () => {
  const sq: LocalPoint[] = [[0, 0], [4, 0], [4, 4], [0, 4]]
  it('is 0 inside and on a vertex', () => {
    expect(distanceToRing([2, 2], sq)).toBe(0)
    expect(distanceToRing([0, 0], sq)).toBe(0)
  })
  it('is the edge distance outside', () => {
    expect(distanceToRing([6, 2], sq)).toBeCloseTo(2)
    expect(distanceToRing([7, 8], sq)).toBeCloseTo(5)
  })
  it('handles a concave ring: the notch of a T is outside', () => {
    const t: LocalPoint[] = [[0, 0], [9, 0], [9, 3], [6, 3], [6, 9], [3, 9], [3, 3], [0, 3]]
    expect(distanceToRing([1, 1], t)).toBe(0)
    expect(distanceToRing([4, 6], t)).toBe(0)
    expect(distanceToRing([1, 6], t)).toBeCloseTo(2)
    expect(distanceToRing([8, 6], t)).toBeCloseTo(2)
  })
})
