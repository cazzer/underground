import { describe, expect, it } from 'vitest'
import type { Direction } from '../data/schema'
import type { Station } from './network'
import type { Ground } from './projection'
import { buildPolyline } from './realtime/polyline'
import {
  journeySpans,
  MAX_STOP_OFFSET_M,
  rideSpan,
  spanPoints,
  stopStations,
  walkSpan,
  type RideShapeSpan,
  type SpanContext,
  type SpanShape,
} from './tripSpans'

function shape(id: string, routeId: string, direction: Direction, primary: boolean, pts: Ground[]): SpanShape {
  const { points, cumulative, length } = buildPolyline(pts)
  return { id, routeId, direction, primary, points: [...points], cumulative: [...cumulative], length }
}
const line = (z: number, x0 = 0, x1 = 1000): Ground[] => [
  { x: x0, z },
  { x: x1, z },
]
function station(id: string, x: number, z = 0): Station {
  return { id, name: id, pos: { x, z }, routeIds: [], stops: [`${id}N`, `${id}S`], access: { status: 'none' }, leadId: id }
}
const stations = [station('A', 100), station('B', 500), station('C', 900), station('Q', 5000, 5000)]
const ctxOf = (shapes: SpanShape[], patterns?: SpanContext['patterns']): SpanContext => ({
  shapes,
  stopStations: stopStations(stations),
  ...(patterns ? { patterns } : {}),
})
const ride = (span: ReturnType<typeof rideSpan>): RideShapeSpan => {
  expect(span.kind).toBe('ride')
  return span as RideShapeSpan
}

describe('rideSpan direction', () => {
  const north = shape('N1', 'X', 'N', true, line(0))
  const south = shape('S1', 'X', 'S', true, [...line(9.4)].reverse())
  const ctx = ctxOf([south, north])

  it('picks the shape of the leg direction', () => {
    expect(ride(rideSpan({ routeId: 'X', stops: ['AN', 'BN'] }, 0, ctx))).toMatchObject({ shapeId: 'N1', d0: 100, d1: 500 })
    const s = ride(rideSpan({ routeId: 'X', stops: ['CS', 'AS'] }, 0, ctx))
    expect(s.shapeId).toBe('S1')
    expect(s.d1).toBeGreaterThan(s.d0)
  })

  it('refuses a run that goes backward along the only candidate', () => {
    const span = rideSpan({ routeId: 'X', stops: ['BN', 'AN'] }, 3, ctxOf([north]))
    expect(span).toMatchObject({ kind: 'straight', legIndex: 3 })
  })

  it('throws on a stop with no direction suffix or no station', () => {
    expect(() => rideSpan({ routeId: 'X', stops: ['A', 'B'] }, 0, ctx)).toThrow(/N or S/)
    expect(() => rideSpan({ routeId: 'X', stops: ['AN', 'ZN'] }, 0, ctx)).toThrow(/ZN/)
    expect(() => rideSpan({ routeId: 'X', stops: [] }, 0, ctx)).toThrow(/no stops/)
  })
})

describe('rideSpan on a hairpin', () => {
  // 300 m east, a 20 m jog, 300 m west: both halves lie within 20 m of each other.
  const hairpin = shape('H', 'X', 'N', true, [
    { x: 0, z: 0 },
    { x: 300, z: 0 },
    { x: 300, z: 20 },
    { x: 0, z: 20 },
  ])
  const hp = [station('P', 50, 0), station('Q2', 100, 20), station('R', 250, 20)]
  const ctx: SpanContext = { shapes: [hairpin], stopStations: stopStations(hp) }

  it('runs from the outbound half to the return half', () => {
    const span = ride(rideSpan({ routeId: 'X', stops: ['PN', 'Q2N'] }, 0, ctx))
    expect(span.d0).toBeCloseTo(50)
    expect(span.d1).toBeCloseTo(520)
  })

  it('keeps a leg that lies on the return half on it', () => {
    const span = ride(rideSpan({ routeId: 'X', stops: ['RN', 'Q2N'] }, 0, ctx))
    expect(span.d0).toBeCloseTo(370)
    expect(span.d1).toBeCloseTo(520)
    expect(span.d1).toBeGreaterThan(span.d0)
  })
})

describe('rideSpan at a terminal', () => {
  const ctx = (endX: number): SpanContext => ({
    shapes: [shape('T', 'X', 'N', true, line(0, 0, 1000))],
    stopStations: stopStations([station('M', 500), station('E', endX)]),
  })

  it('clamps a stop 104 m past the end of the shape', () => {
    const span = ride(rideSpan({ routeId: 'X', stops: ['MN', 'EN'] }, 0, ctx(1104)))
    expect(span.d1).toBe(1000)
    expect(span.maxOffsetM).toBeCloseTo(104)
  })

  it('falls back when the stop is past the offset limit', () => {
    expect(MAX_STOP_OFFSET_M).toBe(150)
    expect(rideSpan({ routeId: 'X', stops: ['MN', 'EN'] }, 0, ctx(1160)).kind).toBe('straight')
  })
})

describe('rideSpan preference', () => {
  it('prefers a primary over a closer variant', () => {
    const primary = shape('P', 'X', 'N', true, line(20))
    const variant = shape('V', 'X', 'N', false, line(5))
    expect(ride(rideSpan({ routeId: 'X', stops: ['AN', 'CN'] }, 0, ctxOf([variant, primary]))).shapeId).toBe('P')
  })

  it('prefers the smaller offset between variants, then the id', () => {
    const near = shape('V2', 'X', 'N', false, line(3))
    const far = shape('V1', 'X', 'N', false, line(8))
    expect(ride(rideSpan({ routeId: 'X', stops: ['AN', 'CN'] }, 0, ctxOf([far, near]))).shapeId).toBe('V2')
    const twin = shape('V0', 'X', 'N', false, line(3))
    expect(ride(rideSpan({ routeId: 'X', stops: ['AN', 'CN'] }, 0, ctxOf([near, twin]))).shapeId).toBe('V0')
  })

  it('treats offsets that differ by float noise as equal', () => {
    const a = shape('V1', 'X', 'N', false, line(3))
    const b = shape('V2', 'X', 'N', false, line(3 + 1e-12))
    const c = shape('V0', 'X', 'N', false, line(3 - 1e-12))
    for (const order of [[a, b], [b, a], [c, b, a], [a, b, c]]) {
      const id = ride(rideSpan({ routeId: 'X', stops: ['AN', 'CN'] }, 0, ctxOf(order))).shapeId
      expect(id).toBe(order.includes(c) ? 'V0' : 'V1')
    }
  })

  it("orders another route's shapes by offset, not by primary", () => {
    const farPrimary = shape('Y1', 'Y', 'N', true, line(40))
    const nearVariant = shape('Y2', 'Y', 'N', false, line(2))
    const span = ride(rideSpan({ routeId: 'X', stops: ['AN', 'CN'] }, 0, ctxOf([farPrimary, nearVariant])))
    expect(span).toMatchObject({ shapeId: 'Y2', matched: 'other' })
  })
})

describe('rideSpan with the pattern hint', () => {
  const express = shape('E', 'X', 'N', true, line(0))
  const local = shape('L', 'X', 'N', false, line(5))
  const patterns = { E: { stops: ['AN', 'CN'] }, L: { stops: ['AN', 'BN', 'CN'] } }
  const stops = { local: ['AN', 'BN', 'CN'], skip: ['AN', 'CN'] }

  it('picks the local for a leg that calls at B, with the hint only', () => {
    expect(ride(rideSpan({ routeId: 'X', stops: stops.local }, 0, ctxOf([express, local], patterns)))).toMatchObject({ shapeId: 'L', matched: 'pattern' })
    expect(ride(rideSpan({ routeId: 'X', stops: stops.local }, 0, ctxOf([express, local])))).toMatchObject({ shapeId: 'E', matched: 'route' })
  })

  it('picks the express for a leg that skips B', () => {
    expect(ride(rideSpan({ routeId: 'X', stops: stops.skip }, 0, ctxOf([express, local], patterns)))).toMatchObject({ shapeId: 'E', matched: 'pattern' })
  })

  it("prefers another route's hinted pattern over its mere geometry", () => {
    const yExpress = shape('Y1', 'Y', 'N', true, line(0))
    const yLocal = shape('Y2', 'Y', 'N', false, line(5))
    const hint = { Y1: { stops: ['AN', 'CN'] }, Y2: { stops: ['AN', 'BN', 'CN'] } }
    const span = ride(rideSpan({ routeId: 'X', stops: stops.local }, 0, ctxOf([yExpress, yLocal], hint)))
    expect(span).toMatchObject({ shapeId: 'Y2', matched: 'pattern-other' })
    expect(ride(rideSpan({ routeId: 'X', stops: stops.local }, 0, ctxOf([yExpress, yLocal]))).matched).toBe('other')
  })

  it('falls back to geometry when no hinted pattern holds the run', () => {
    const span = ride(rideSpan({ routeId: 'X', stops: stops.local }, 0, ctxOf([express, local], { E: patterns.E })))
    expect(span).toMatchObject({ shapeId: 'E', matched: 'route' })
  })
})

describe('rideSpan fallbacks', () => {
  it("uses another route's shape in the direction when the route has none that fits", () => {
    const other = shape('Y1', 'Y', 'N', true, line(0))
    expect(ride(rideSpan({ routeId: 'X', stops: ['AN', 'BN'] }, 0, ctxOf([other])))).toMatchObject({ shapeId: 'Y1', matched: 'other' })
  })

  it('draws a straight line through the stop points when nothing is near', () => {
    const span = rideSpan({ routeId: 'X', stops: ['AN', 'QN'] }, 2, ctxOf([shape('N1', 'X', 'N', true, line(0))]))
    expect(span).toEqual({ kind: 'straight', legIndex: 2, routeId: 'X', points: [{ x: 100, z: 0 }, { x: 5000, z: 5000 }] })
  })
})

describe('walkSpan and journeySpans', () => {
  const ctx = ctxOf([shape('N1', 'X', 'N', true, line(0))])

  it('draws nothing for a change inside a station', () => {
    expect(walkSpan({ fromStop: 'AN', toStop: 'AS', sameStation: true }, 0, ctx)).toBeNull()
  })

  it("joins each stop's own station point", () => {
    expect(walkSpan({ fromStop: 'AN', toStop: 'BS', sameStation: false }, 1, ctx)).toEqual({
      kind: 'walk',
      legIndex: 1,
      fromStationId: 'A',
      toStationId: 'B',
      sameComplex: false,
      from: { x: 100, z: 0 },
      to: { x: 500, z: 0 },
    })
  })

  it('marks a walk between two members of one complex', () => {
    const members = [{ ...station('A', 100), leadId: 'A' }, { ...station('B', 500), leadId: 'A' }, station('C', 900)]
    const mctx: SpanContext = { shapes: [], stopStations: stopStations(members) }
    expect(walkSpan({ fromStop: 'AN', toStop: 'BS', sameStation: false }, 0, mctx)).toMatchObject({ sameComplex: true })
    expect(walkSpan({ fromStop: 'AN', toStop: 'CS', sameStation: false }, 0, mctx)).toMatchObject({ sameComplex: false })
  })

  it('throws on an unknown stop', () => {
    expect(() => walkSpan({ fromStop: 'AN', toStop: 'ZS', sameStation: false }, 0, ctx)).toThrow(/ZS/)
  })

  it('lists spans in leg order and drops the legs that draw nothing', () => {
    const spans = journeySpans(
      [
        { kind: 'ride', routeId: 'X', stops: ['AN', 'BN'] },
        { kind: 'walk', fromStop: 'BN', toStop: 'BS', sameStation: true },
        { kind: 'walk', fromStop: 'BN', toStop: 'CS', sameStation: false },
        { kind: 'ride', routeId: 'X', stops: ['CN', 'QN'] },
      ],
      ctx,
    )
    expect(spans.map((s) => [s.kind, s.legIndex])).toEqual([
      ['ride', 0],
      ['walk', 2],
      ['straight', 3],
    ])
  })
})

describe('spanPoints', () => {
  const path = shape('S', 'X', 'N', true, [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 100 },
  ])

  it('interpolates both ends and keeps the vertices between', () => {
    expect(spanPoints(path, 50, 150)).toEqual([
      { x: 50, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 50 },
    ])
  })

  it('adds no duplicate when an end lands on a vertex', () => {
    expect(spanPoints(path, 100, 150)).toEqual([
      { x: 100, z: 0 },
      { x: 100, z: 50 },
    ])
    expect(spanPoints(path, 50, 100)).toEqual([
      { x: 50, z: 0 },
      { x: 100, z: 0 },
    ])
  })
})
