import { describe, expect, it } from 'vitest'
import { decodeShapePoints } from '../../src/data/codec.ts'
import { fixtureFeed } from './fixture.ts'
import { buildShapes } from './shapes.ts'
import { toStableJson } from './stableJson.ts'

describe('buildShapes', () => {
  const shapes = buildShapes(fixtureFeed(), 3)
  const byId = new Map(shapes.map((s) => [s.id, s]))

  it('emits every trip-referenced shape and drops unreferenced ones', () => {
    expect(shapes.map((s) => s.id)).toEqual(['1..S03R', '1..S04R', 'GS..N01R', 'N..S72R', 'N..S73R', 'SI..S03R'])
  })
  it('canonicalizes single-dot GS ids', () => {
    expect(byId.get('GS..N01R')).toMatchObject({ routeId: 'GS', direction: 'N' })
  })
  it('keeps trips.txt route_id on a shape whose token differs (W on N..)', () => {
    expect(byId.get('N..S72R')?.routeId).toBe('W')
  })
  it('marks the most-used shape per route+direction, ties to the smaller id', () => {
    expect(shapes.filter((s) => s.primary).map((s) => s.id)).toEqual(['1..S03R', 'GS..N01R', 'N..S72R', 'SI..S03R'])
  })
  it('orders points numerically from shuffled input (sequence 10 after 9)', () => {
    const points = decodeShapePoints(byId.get('1..S03R')!)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ lat: 40.7, lon: -74 })
    expect(points[1]!.lat).toBeCloseTo(40.711, 5)
  })
  it('simplifies at the tolerance but keeps the corner of an L', () => {
    const points = decodeShapePoints(byId.get('1..S04R')!)
    expect(points).toEqual([
      { lat: 40.7, lon: -74 },
      { lat: 40.702, lon: -74 },
      { lat: 40.702, lon: -73.996 },
    ])
  })
  it('stores delta-encoded integers', () => {
    expect(byId.get('N..S72R')).toMatchObject({ lat: [4070000, 300], lon: [-7400000, 0] })
  })
  it('throws on a trip-referenced shape with no points', () => {
    const feed = fixtureFeed()
    feed.shapePoints = feed.shapePoints.filter((p) => p.shapeId !== 'N..S73R')
    expect(() => buildShapes(feed, 3)).toThrow(/N\.\.S73R/)
  })
  it('throws when a shape is used by two routes', () => {
    const feed = fixtureFeed()
    feed.trips.find((t) => t.shapeId === '1..S03R')!.routeId = 'W'
    expect(() => buildShapes(feed, 3)).toThrow(/more than one route/)
  })
  it('gives byte-identical JSON regardless of input order', () => {
    const feed = fixtureFeed()
    feed.shapePoints.reverse()
    feed.trips.reverse()
    expect(toStableJson({ shapes: buildShapes(feed, 3) }, 2)).toBe(toStableJson({ shapes }, 2))
  })
})
