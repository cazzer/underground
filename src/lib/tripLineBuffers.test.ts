import { describe, expect, it } from 'vitest'
import { NO_BANDS } from './corridors'
import { buildLineBuffers, vertexBandInputs, type Rgb } from './lineBuffers'
import type { ShapePath } from './network'
import { EMPTY_PROFILE } from './trackProfile'
import { segmentWindow, tripLineBuffers } from './tripLineBuffers'
import type { RideShapeSpan } from './tripSpans'

/** A straight shape along x through `xs`, with heights and band slots that differ per point so a copy shows. */
function path(id: string, routeId: string, xs: number[], extra: Partial<ShapePath> = {}): ShapePath {
  const points = xs.map((x) => ({ x, z: 0 }))
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z))
  return {
    id,
    routeId,
    direction: 'N',
    primary: true,
    points,
    cumulative,
    length: cumulative[cumulative.length - 1]!,
    y: xs.map((_, i) => -i),
    profile: EMPTY_PROFILE,
    bandInputs: vertexBandInputs(points, xs.map((_, i) => i % 3), xs.map(() => 1)),
    bands: NO_BANDS,
    ...extra,
  }
}

const ride = (shapeId: string, routeId: string, d0: number, d1: number, legIndex = 0): RideShapeSpan => ({
  kind: 'ride',
  legIndex,
  routeId,
  shapeId,
  d0,
  d1,
  maxOffsetM: 0,
  matched: 'route',
})

const COLORS: Record<string, Rgb> = { L: [0.5, 0.5, 0.5], N: [1, 0.8, 0] }
const colorOf = (id: string): Rgb => COLORS[id]!

describe('segmentWindow', () => {
  it('draws a segment inside the span whole', () => {
    expect(segmentWindow(10, 20, 0, 100)).toEqual([0, 1])
  })

  it('cuts a segment the span starts or ends in at the stop', () => {
    expect(segmentWindow(0, 20, 5, 100)).toEqual([0.25, 1])
    expect(segmentWindow(0, 20, -5, 15)).toEqual([0, 0.75])
    expect(segmentWindow(0, 20, 5, 15)).toEqual([0.25, 0.75])
  })

  it('leaves out a segment that only touches the span at a vertex, or lies outside it', () => {
    expect(segmentWindow(0, 10, 10, 20)).toBeNull()
    expect(segmentWindow(20, 30, 10, 20)).toBeNull()
    expect(segmentWindow(40, 50, 10, 20)).toBeNull()
  })

  it('draws a zero-length segment strictly inside whole, and none at an end', () => {
    expect(segmentWindow(15, 15, 10, 20)).toEqual([0, 1])
    expect(segmentWindow(10, 10, 10, 20)).toBeNull()
    expect(segmentWindow(20, 20, 10, 20)).toBeNull()
  })
})

describe('tripLineBuffers', () => {
  const l = path('L..N01R', 'L', [0, 10, 20, 30, 40])
  const n = path('N..N01R', 'N', [100, 110, 120])
  const paths = [l, n]

  it('copies exactly the overlapping segments, as the map layer draws them', () => {
    const out = tripLineBuffers(paths, [ride(l.id, 'L', 5, 25)], colorOf)
    expect(out.positions.length / 6).toBe(3)
    const map = buildLineBuffers([l], new Map([['L', 0]]), colorOf, false)
    // Segments 0..2 of the shape: the same positions (with the profile's y) and band inputs, byte for byte.
    expect(out.positions).toEqual(map.positions.subarray(0, 18))
    expect(out.bands).toEqual(map.bands.subarray(0, 3 * 8))
    expect(out.colors).toEqual(map.colors.subarray(0, 18))
  })

  it('windows the first and last segment so their ends land on d0 and d1', () => {
    const d0 = 5.3
    const d1 = 27.9
    const out = tripLineBuffers(paths, [ride(l.id, 'L', d0, d1)], colorOf)
    const count = out.windows.length / 2
    const along = (seg: number, t: number) => l.cumulative[seg]! + t * (l.cumulative[seg + 1]! - l.cumulative[seg]!)
    // The first copied segment is shape segment 0, the last shape segment 2.
    expect(along(0, out.windows[0]!)).toBeCloseTo(d0, 5)
    expect(along(2, out.windows[(count - 1) * 2 + 1]!)).toBeCloseTo(d1, 5)
    expect(Array.from(out.windows.subarray(2, 4))).toEqual([0, 1])
  })

  it('draws a covered variant segment too: the trip line is its own layer', () => {
    const variant = path('L..N02R', 'L', [0, 10, 20], { primary: false, cover: { primaryId: l.id, segments: new Uint8Array([1, 0]) } })
    const out = tripLineBuffers([...paths, variant], [ride(variant.id, 'L', 0, 20)], colorOf)
    expect(out.positions.length / 6).toBe(2)
    const map = buildLineBuffers([variant], new Map([['L', 0]]), colorOf, false)
    expect(out.positions).toEqual(map.positions)
    expect(out.bands).toEqual(map.bands)
  })

  it('draws two rides in journey order, each in its route color, and maps each shape segment to its copy', () => {
    const out = tripLineBuffers(paths, [ride(l.id, 'L', 0, 20), ride(n.id, 'N', 0, 15, 2)], colorOf)
    expect(out.positions.length / 6).toBe(4)
    expect(Array.from(out.colors.subarray(0, 3))).toEqual([0.5, 0.5, 0.5])
    expect(Array.from(out.colors.subarray(18, 21))).toEqual([1, 0.800000011920929, 0])
    expect(Array.from(out.segments.get(l.id)!)).toEqual([0, 1, -1, -1])
    expect(Array.from(out.segments.get(n.id)!)).toEqual([2, 3])
    expect(out.positions[2 * 6]).toBe(100)
  })

  it('maps a stretch two rides share to the first copy only', () => {
    const out = tripLineBuffers(paths, [ride(l.id, 'L', 0, 20), ride(l.id, 'L', 10, 30, 2)], colorOf)
    expect(out.positions.length / 6).toBe(4)
    expect(Array.from(out.segments.get(l.id)!)).toEqual([0, 1, 3, -1])
  })

  it('draws nothing for no rides', () => {
    expect(tripLineBuffers(paths, [], colorOf).positions.length).toBe(0)
  })

  it('throws for a ride on a shape the map lacks', () => {
    expect(() => tripLineBuffers(paths, [ride('X..N', 'L', 0, 10, 3)], colorOf)).toThrow('Trip ride leg 3 draws on shape "X..N"')
  })
})
