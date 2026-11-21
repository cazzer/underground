import { describe, expect, it } from 'vitest'
import { MITER_LIMIT, offsetPolyline, resolveTrackOffset, TRACK_OFFSETS } from './trackOffset'

const D = 4.7
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

describe('offsetPolyline', () => {
  it('moves an eastbound line south (right of travel; z is south)', () => {
    const out = offsetPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }], D)
    expect(out).toEqual([{ x: 0, z: D }, { x: 10, z: D }, { x: 20, z: D }])
  })

  it('moves left for a negative offset', () => {
    const out = offsetPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }], -D)
    expect(out).toEqual([{ x: 0, z: -D }, { x: 10, z: -D }])
  })

  it('puts a 90 degree corner √2·d out along the bisector', () => {
    // East, then south: the right side is the inside of the turn.
    const out = offsetPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], D)
    expect(out[1]!.x).toBeCloseTo(10 - D)
    expect(out[1]!.z).toBeCloseTo(D)
    expect(dist(out[1]!, { x: 10, z: 0 })).toBeCloseTo(Math.SQRT2 * D)
    expect(out[2]!.x).toBeCloseTo(10 - D)
    expect(out[2]!.z).toBeCloseTo(10)
  })

  it('caps the miter of a 170 degree bend at MITER_LIMIT·d', () => {
    // Heading east, then turning 170 degrees: the outgoing heading is 170 degrees from east.
    const turn = (170 * Math.PI) / 180
    const corner = { x: 10, z: 0 }
    const out = offsetPolyline([{ x: 0, z: 0 }, corner, { x: 10 + 10 * Math.cos(turn), z: 10 * Math.sin(turn) }], D)
    expect(dist(out[1]!, corner)).toBeCloseTo(MITER_LIMIT * D)
  })

  it('keeps the incoming normal on a full reversal', () => {
    const out = offsetPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 0 }], D)
    expect(out[1]).toEqual({ x: 10, z: D })
    expect(out).toHaveLength(3)
  })

  it('borrows a neighbor normal for duplicate points and keeps the count', () => {
    const out = offsetPolyline([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 0 }], D)
    expect(out).toEqual([{ x: 0, z: D }, { x: 0, z: D }, { x: 10, z: D }, { x: 10, z: D }])
  })

  it('returns a copy for empty, one-point, and all-identical input', () => {
    expect(offsetPolyline([], D)).toEqual([])
    expect(offsetPolyline([{ x: 1, z: 2 }], D)).toEqual([{ x: 1, z: 2 }])
    const same = [{ x: 3, z: 3 }, { x: 3, z: 3 }]
    const out = offsetPolyline(same, D)
    expect(out).toEqual(same)
    expect(out).not.toBe(same)
  })

  it('leaves points unchanged at offset 0', () => {
    const pts = [{ x: 0, z: 0 }, { x: 5, z: 3 }, { x: 9, z: -2 }]
    expect(offsetPolyline(pts, 0)).toEqual(pts)
  })

  it('puts a line and its reverse 2·d apart', () => {
    const pts = [{ x: 0, z: 0 }, { x: 30, z: 40 }, { x: 60, z: 40 }]
    const fwd = offsetPolyline(pts, D)
    const rev = offsetPolyline([...pts].reverse(), D).reverse()
    expect(dist(fwd[0]!, rev[0]!)).toBeCloseTo(2 * D)
    expect(dist(fwd[2]!, rev[2]!)).toBeCloseTo(2 * D)
  })
})

describe('resolveTrackOffset', () => {
  it('reads ?tracks= and defaults to a', () => {
    expect(resolveTrackOffset('')).toBe(TRACK_OFFSETS.a)
    expect(resolveTrackOffset('?tracks=b')).toBe(TRACK_OFFSETS.b)
    expect(resolveTrackOffset('?theme=x&tracks=off')).toBe(0)
    expect(resolveTrackOffset('?tracks=zzz')).toBe(TRACK_OFFSETS.a)
  })
})
