import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { StationDepthsFile, StationInterior } from '../data/stationSchema'
import { buildNetwork } from './network'
import {
  MASK_INSET_M,
  maskSpanWeight,
  platformSpans,
  rampWeight,
  TRAIN_RAMP_M,
  trainSpanWeight,
  PLATFORM_RESIDUAL_TINT,
  veilTint,
  type PlatformSpan,
} from './platformSpan'
import { toGround } from './projection'
import { buildPolyline, pointAtDistance, projectForward } from './realtime/polyline'
import { trackLine } from './trackLine'
import { TRACK_OFFSET_M } from './trackOffset'
import { profileAt } from './trackProfile'

/** Largest change between samples `step` apart over [from, to]: small for a continuous weight. */
function maxJump(f: (d: number) => number, from: number, to: number, step = 0.25): number {
  let worst = 0
  for (let d = from; d < to; d += step) worst = Math.max(worst, Math.abs(f(d + step) - f(d)))
  return worst
}

describe('platformSpans', () => {
  it('groups kept runs by station and shape, unions a shape riding two tracks, and skips runs without a station', () => {
    const spans = platformSpans([
      ['a', [{ d0: 100, d1: 200, yReal: -10, stationId: 'S1' }, { d0: 900, d1: 950, yReal: -8, stationId: 'S2' }]],
      ['b', [{ d0: 10, d1: 20, yReal: -5, stationId: 'S1' }, { d0: 30, d1: 60, yReal: -5, stationId: 'S1' }]],
      ['c', [{ d0: 0, d1: 5, yReal: -5 }]],
    ])
    expect([...spans.keys()]).toEqual(['S1', 'S2'])
    expect(spans.get('S1')).toEqual(new Map([['a', { d0: 100, d1: 200 }], ['b', { d0: 10, d1: 60 }]]))
    expect(spans.get('S2')).toEqual(new Map([['a', { d0: 900, d1: 950 }]]))
  })
})

describe('span weights', () => {
  const span: PlatformSpan = { d0: 1000, d1: 1170 }

  it('lifts a car fully along the platform and not at all past the ramp, continuously', () => {
    for (const d of [1000, 1085, 1170]) expect(trainSpanWeight(d, span)).toBe(1)
    for (const d of [1000 - TRAIN_RAMP_M, 1170 + TRAIN_RAMP_M, 0, 5000]) expect(trainSpanWeight(d, span)).toBe(0)
    expect(trainSpanWeight(1170 + TRAIN_RAMP_M / 2, span)).toBeCloseTo(0.5, 12)
    expect(maxJump((d) => trainSpanWeight(d, span), 900, 1270)).toBeLessThan(0.01)
  })

  it('masks the map track inside the platform, easing to nothing at its ends', () => {
    expect(maskSpanWeight(1000, span)).toBe(0)
    expect(maskSpanWeight(1170, span)).toBe(0)
    expect(maskSpanWeight(990, span)).toBe(0)
    for (const d of [1000 + MASK_INSET_M, 1085, 1170 - MASK_INSET_M]) expect(maskSpanWeight(d, span)).toBe(1)
    expect(maxJump((d) => maskSpanWeight(d, span), 990, 1180)).toBeLessThan(0.05)
  })

  it('peaks below 1 midway when the span is shorter than its two ramps', () => {
    // Start 6, end 4: the midpoint is 1 m outside both, so smoothstep(0.75).
    expect(rampWeight(5, 6, 4, 4)).toBeCloseTo(0.84375, 12)
    expect(rampWeight(5, 8, 2, 4)).toBeCloseTo(0.15625, 12)
  })

  it('keeps a residual veil tint on the platform and the full veil where a car leaves it, and not at all before the reveal', () => {
    expect(veilTint(1, 1, 0.7)).toBeCloseTo(PLATFORM_RESIDUAL_TINT * 0.7, 12)
    expect(veilTint(1, 0, 0.7)).toBeCloseTo(0.7, 12)
    expect(veilTint(0.5, 0.5, 0.7)).toBeCloseTo(0.21, 12)
    expect(veilTint(0, 0, 0.7)).toBe(0)
  })
})

describe('Bedford Av (L08) platform spans, committed data', () => {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const stationsFile = readJson('../../public/data/stations.json') as StationsFile
  const routesFile = readJson('../../public/data/routes.json') as RoutesFile
  const shapesFile = readJson('../../public/data/shapes.json') as ShapesFile
  const depths = readJson('../../public/data/station-depths.json') as StationDepthsFile
  const l08 = readJson('../../public/data/stations/L08.json') as StationInterior
  const network = buildNetwork(stationsFile, routesFile, shapesFile, TRACK_OFFSET_M, depths, 2)
  const spans = network.platformSpans.get('L08')!
  const anchor = toGround(l08.anchor)
  const depth = depths.stations.find((s) => s.stationId === 'L08')!

  it('gives every L shape riding Bedford Av a span, and only those', () => {
    expect(spans.size).toBeGreaterThan(0)
    for (const id of spans.keys()) expect(network.shapes.find((s) => s.id === id)!.routeId, id).toBe('L')
    expect([...network.platformSpans.keys()]).toEqual(['L08'])
  })

  it.each(['N', 'S'] as const)('puts the L..%s trains on their own track at its rail depth, within the platform extent', (dir) => {
    const track = depth.tracks.find((t) => t.stopId === `L08${dir}`)!
    const [a, b] = track.ends.map(([x, z]) => ({ x: anchor.x + x, z: anchor.z + z }))
    const trackLength = Math.hypot(b!.x - a!.x, b!.z - a!.z)
    const riders = network.shapes.filter((s) => spans.has(s.id))
    expect(riders.filter((s) => s.direction === dir).length).toBeGreaterThan(0)
    for (const shape of riders.filter((s) => s.direction === dir)) {
      const span = spans.get(shape.id)!
      // The realtime geometry's line (flat track line) gives the same distances as the drawn path.
      const line = buildPolyline(trackLine(shapesFile.shapes.find((s) => s.id === shape.id)!, TRACK_OFFSET_M))
      const ends = [a!, b!].map((p) => projectForward(line, p, { segment: 0, t: 0 }))
      expect(Math.min(...ends.map((e) => e.distance)), shape.id).toBeCloseTo(span.d0, 6)
      expect(Math.max(...ends.map((e) => e.distance)), shape.id).toBeCloseTo(span.d1, 6)
      expect(Math.abs(span.d1 - span.d0 - trackLength), shape.id).toBeLessThan(3)
      for (let t = 0; t <= 1; t += 0.125) {
        const d = span.d0 + (span.d1 - span.d0) * t
        expect(profileAt(shape.profile, d), `${shape.id} at ${t}`).toBeCloseTo(track.railY * 2, 9)
        expect(trainSpanWeight(d, span)).toBe(1)
        // Within the platform: the shape's point there is within a few meters of the authored track.
        const p = pointAtDistance(line, d).point
        const u = Math.min(Math.max(((p.x - a!.x) * (b!.x - a!.x) + (p.z - a!.z) * (b!.z - a!.z)) / trackLength ** 2, 0), 1)
        const q = { x: a!.x + (b!.x - a!.x) * u, z: a!.z + (b!.z - a!.z) * u }
        expect(Math.hypot(p.x - q.x, p.z - q.z), `${shape.id} at ${t}`).toBeLessThan(3)
      }
    }
  })
})
