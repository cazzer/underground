import { describe, expect, it } from 'vitest'
import type { Direction } from '../data/schema'
import { bandKey, cleanPresence, corridorBands, NO_BANDS, type CorridorShape } from './corridors'
import type { Ground } from './projection'
import { buildPolyline } from './realtime/polyline'
import { profileAt } from './trackProfile'

const ROUTES = ['A', 'B', 'C', 'CX', 'D'].map((id) => ({ id, shortName: id }))

function shape(id: string, routeId: string, direction: Direction, points: Ground[]): CorridorShape {
  return { id, routeId, direction, primary: true, line: buildPolyline(points) }
}

/** A straight line from (x, z0) to (x, z1): north when z1 < z0. */
const straight = (x: number, z0: number, z1: number): Ground[] => [
  { x, z: z0 },
  { x, z: z1 },
]

describe('bandKey', () => {
  it('folds an express variant into its route', () => {
    expect(['6X', 'FX', '7X', 'X', 'GS', 'A'].map(bandKey)).toEqual(['6', 'F', '7', 'X', 'GS', 'A'])
  })
})

describe('cleanPresence', () => {
  const masks = (bits: string) => Int32Array.from(bits, (b) => (b === '1' ? 4 : 0))
  const bits = (m: Int32Array) => [...m].map((v) => (v & 4 ? '1' : '0')).join('')

  it('fills short gaps between two stretches and drops short stretches', () => {
    const m = masks('1111100111110000011000')
    cleanPresence(m, 4, 3, 4)
    expect(bits(m)).toBe('1111111111110000000000')
  })

  it('keeps a gap at either end and a long gap', () => {
    const m = masks('00111110000111110')
    cleanPresence(m, 4, 3, 4)
    expect(bits(m)).toBe('00111110000111110')
  })
})

describe('corridorBands', () => {
  const slotAt = (bands: ReturnType<typeof corridorBands>, id: string, d: number) => profileAt((bands.get(id) ?? NO_BANDS).slot, d)
  const halfAt = (bands: ReturnType<typeof corridorBands>, id: string, d: number) => profileAt((bands.get(id) ?? NO_BANDS).half, d)

  it('bands three routes on one track in rank order, both directions ordering them the same way across the street', () => {
    const shapes = [
      shape('a', 'A', 'N', straight(0, 0, -2000)),
      shape('b', 'B', 'N', straight(0.2, 0, -2000)),
      shape('c', 'C', 'N', straight(-0.2, 0, -2000)),
      shape('as', 'A', 'S', straight(-9.4, -2000, 0)),
      shape('bs', 'B', 'S', straight(-9.4, -2000, 0)),
      shape('cs', 'C', 'S', straight(-9.4, -2000, 0)),
    ]
    const bands = corridorBands(shapes, ROUTES)
    expect(['a', 'b', 'c'].map((id) => slotAt(bands, id, 1000))).toEqual([-1, 0, 1])
    // Southbound, right of travel is west: A at +1 is west too, as northbound A at -1 (left of travel) is.
    expect(['as', 'bs', 'cs'].map((id) => slotAt(bands, id, 1000))).toEqual([1, 0, -1])
    expect(['a', 'b', 'cs'].map((id) => halfAt(bands, id, 1000))).toEqual([1, 1, 1])
  })

  it('orders the bands as the tracks lie across the corridor, so a band shift adds to the real gap', () => {
    // C runs 3 m west of A and B 2 m east: route_sort_order alone would put C east of both.
    const shapes = [
      shape('a', 'A', 'N', straight(0, 0, -2000)),
      shape('b', 'B', 'N', straight(2, 0, -2000)),
      shape('c', 'C', 'N', straight(-3, 0, -2000)),
      shape('as', 'A', 'S', straight(-9.4, -2000, 0)),
      shape('bs', 'B', 'S', straight(-7.4, -2000, 0)),
      shape('cs', 'C', 'S', straight(-12.4, -2000, 0)),
    ]
    const bands = corridorBands(shapes, ROUTES)
    expect(['c', 'a', 'b'].map((id) => slotAt(bands, id, 1000))).toEqual([-1, 0, 1])
    expect(['cs', 'as', 'bs'].map((id) => slotAt(bands, id, 1000))).toEqual([1, 0, -1])
  })

  it('tapers a route that leaves the corridor back to the center', () => {
    const shapes = [
      shape('a', 'A', 'N', straight(0, 0, -3000)),
      // C runs with A for 1.5 km, then turns 45 degrees east.
      shape('c', 'C', 'N', [{ x: 0, z: 0 }, { x: 0, z: -1500 }, { x: 1000, z: -2500 }]),
    ]
    const bands = corridorBands(shapes, ROUTES)
    expect(slotAt(bands, 'a', 700)).toBe(-0.5)
    expect(slotAt(bands, 'c', 700)).toBe(0.5)
    expect(halfAt(bands, 'a', 700)).toBe(0.5)
    expect(slotAt(bands, 'a', 2500)).toBe(0)
    expect(slotAt(bands, 'c', 2500)).toBe(0)
    expect(halfAt(bands, 'c', 2500)).toBe(0)
    // The ease spans no more than the taper.
    const a = bands.get('a')!.slot
    expect(a.d.at(-1)! - a.d[0]!).toBeLessThanOrEqual(300)
  })

  it('keeps every slot on its side when a lower-ranked route joins with the other GTFS direction', () => {
    // B and C run north labelled N for 3 km; A joins them for the middle km heading the same way but labelled S
    // (the M beside the J and Z). Its own southbound twin runs alongside, the other way.
    const shapes = [
      shape('b', 'B', 'N', straight(0, 0, -3000)),
      shape('c', 'C', 'N', straight(1, 0, -3000)),
      shape('a', 'A', 'S', [{ x: 200, z: -800 }, { x: 0, z: -1000 }, { x: 0, z: -2000 }, { x: 200, z: -2200 }]),
      shape('bs', 'B', 'S', straight(-9.4, -3000, 0)),
      shape('cs', 'C', 'S', straight(-9.4, -3000, 0)),
    ]
    const bands = corridorBands(shapes, ROUTES)
    const order = (d: number) => Math.sign(slotAt(bands, 'c', d) - slotAt(bands, 'b', d))
    expect(order(500)).toBe(1)
    expect(order(1500)).toBe(1)
    expect(order(2700)).toBe(1)
    // A sits on B's side of the bundle (rank 0 below B), like B sits below C.
    const aAt = bands.get('a')!.slot
    expect(Math.sign(profileAt(aAt, 600) - slotAt(bands, 'b', 1500))).toBe(-1)
  })

  it('leaves alone routes heading the other way, crossing, farther than the reach, or near for under 200 m', () => {
    const shapes = [
      shape('a', 'A', 'N', straight(0, 0, -2000)),
      shape('b', 'B', 'S', straight(-9.4, -2000, 0)),
      shape('c', 'C', 'N', [{ x: -1000, z: -1000 }, { x: 1000, z: -1000 }]),
      shape('d', 'D', 'N', straight(25, 0, -2000)),
    ]
    expect(corridorBands(shapes, ROUTES).size).toBe(0)
    const brief = [
      shape('a', 'A', 'N', straight(0, 0, -2000)),
      // Within 18 m of A for about 150 m only.
      shape('b', 'B', 'N', [{ x: 60, z: 0 }, { x: 60, z: -900 }, { x: 10, z: -950 }, { x: 10, z: -1100 }, { x: 60, z: -1150 }, { x: 60, z: -2000 }]),
    ]
    expect(corridorBands(brief, ROUTES).size).toBe(0)
  })

  it('shares one band between a route and its express variant', () => {
    const shapes = [shape('c', 'C', 'N', straight(0, 0, -2000)), shape('cx', 'CX', 'N', straight(0, 0, -2000))]
    expect(corridorBands(shapes, ROUTES).size).toBe(0)
  })

  it('gives same-heading routes with different GTFS directions different slots', () => {
    const shapes = [shape('a', 'A', 'N', straight(0, 0, -2000)), shape('b', 'B', 'S', straight(0, 0, -2000))]
    const bands = corridorBands(shapes, ROUTES)
    expect(slotAt(bands, 'a', 1000)).toBe(-slotAt(bands, 'b', 1000))
    expect(Math.abs(slotAt(bands, 'a', 1000))).toBe(0.5)
  })

  it('throws for a shape of an unknown route', () => {
    expect(() => corridorBands([shape('z', 'Z', 'N', straight(0, 0, -100))], ROUTES)).toThrow(/unknown route/)
  })
})
