import { describe, expect, it } from 'vitest'
import {
  canonicalShapeId,
  decodeShapePoints,
  deltaDecode,
  deltaEncode,
  parseTripId,
  segmentKey,
  shapeIdOf,
  tripKey,
} from './codec'

describe('parseTripId', () => {
  it('parses a static trip id', () => {
    expect(parseTripId('AFA26GEN-1038-Sunday-00_000600_1..S03R')).toEqual({
      origin: 600,
      route: '1',
      direction: 'S',
      path: '03R',
    })
  })
  it('parses a single-dot realtime SI id', () => {
    expect(parseTripId('126600_SI.S03R')).toEqual({ origin: 126600, route: 'SI', direction: 'S', path: '03R' })
  })
  it('parses an id with no path code', () => {
    expect(parseTripId('126250_L..S')).toEqual({ origin: 126250, route: 'L', direction: 'S', path: '' })
  })
  it('parses an unusual path code', () => {
    expect(parseTripId('127450_C..N04X006')?.path).toBe('04X006')
  })
  it('parses static GS and SI ids', () => {
    expect(parseTripId('AFA26GEN-GS-Weekday-00_000100_GS.N01R')?.route).toBe('GS')
    expect(parseTripId('AFA26GEN-SI-Weekday-00_000500_SI..S03R')?.route).toBe('SI')
  })
  it('returns null for garbage', () => {
    expect(parseTripId('garbage')).toBeNull()
    expect(parseTripId('')).toBeNull()
    expect(parseTripId('12345_1..S03R')).toBeNull()
  })
})

describe('shape and trip keys', () => {
  it('passes double-dot shape ids through and fixes single-dot ids', () => {
    expect(canonicalShapeId('1..S03R')).toBe('1..S03R')
    expect(canonicalShapeId('GS.N01R')).toBe('GS..N01R')
    expect(canonicalShapeId('SI.S03R')).toBe('SI..S03R')
  })
  it('throws on an unparseable shape id', () => {
    expect(() => canonicalShapeId('')).toThrow()
    expect(() => canonicalShapeId('nope')).toThrow()
  })
  it('gives the same key for static and realtime SI ids', () => {
    const stat = parseTripId('AFA26GEN-SI-Weekday-00_126600_SI..S03R')!
    const live = parseTripId('126600_SI.S03R')!
    expect(tripKey(stat.origin, stat.route, stat.direction)).toBe(tripKey(live.origin, live.route, live.direction))
    expect(shapeIdOf(live)).toBe('SI..S03R')
  })
  it('zero-pads the origin to 6 digits', () => {
    expect(tripKey(600, '1', 'S')).toBe('000600_1..S')
    expect(tripKey(126600, 'SI', 'N')).toBe('126600_SI..N')
  })
  it('joins segment keys', () => {
    expect(segmentKey('101S', '103S')).toBe('101S>103S')
  })
})

describe('delta codec', () => {
  it('round-trips, including empty', () => {
    for (const values of [[], [5], [10, 7, 7, 12, -3]]) {
      expect(deltaDecode(deltaEncode(values))).toEqual(values)
    }
  })
  it('keeps the first value absolute', () => {
    expect(deltaEncode([10, 12, 9])).toEqual([10, 2, -3])
  })
})

describe('decodeShapePoints', () => {
  it('decodes delta E5 lat/lon into degrees', () => {
    const points = decodeShapePoints({ lat: [4070000, 100, -50], lon: [-7400000, -20, 30] })
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ lat: 40.7, lon: -74 })
    expect(points[2]!.lat).toBeCloseTo(40.7005, 5)
    expect(points[2]!.lon).toBeCloseTo(-73.9999, 5)
  })
})
