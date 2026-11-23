/**
 * Trip spans on the committed public/data: the L08 to 127 plan draws both rides on shapes within 150 m of every
 * stop, banding the shapes moves no span, and the trip-index pattern hint tells an express from a local. The daily
 * refresh changes the feed, so these are shares and properties, never shape ids.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { RoutesFile, ShapesFile, StationsFile, TransfersFile, TripIndexFile } from '../data/schema'
import type { PackedDepthsFile } from '../data/stationSchema'
import type { TimetableFile } from '../data/timetableSchema'
import { buildNetwork } from './network'
import { bandNetwork } from './networkBands'
import { route } from './route/raptor'
import { buildRouterTimetable } from './route/timetable'
import type { RideLeg } from './route/types'
import { TRACK_OFFSET_M } from './trackOffset'
import type { Ground } from './projection'
import { journeySpans, MAX_STOP_OFFSET_M, rideSpan, spanPoints, stopStations, type RideShapeSpan, type SpanContext } from './tripSpans'

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const stationsFile = read<StationsFile>('stations.json')
const tripIndex = read<TripIndexFile>('trip-index.json')
const network = buildNetwork(
  stationsFile,
  read<RoutesFile>('routes.json'),
  read<ShapesFile>('shapes.json'),
  TRACK_OFFSET_M,
  read<PackedDepthsFile>('station-depths.json'),
  2,
)
const banded = bandNetwork(network)
const stopMap = stopStations(network.stations)
const unbandedCtx: SpanContext = { shapes: network.shapes, stopStations: stopMap }
const hintedCtx: SpanContext = { ...unbandedCtx, patterns: tripIndex.patterns }
const bandedCtx: SpanContext = { shapes: banded.shapes, stopStations: stopMap, patterns: tripIndex.patterns }

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
const timetable = buildRouterTimetable(
  [{ label: 'Weekday', shiftS: 0, file: read<TimetableFile>('timetable/Weekday.json') }],
  stationsFile,
  read<TransfersFile>('route/transfers.json').transfers,
)
warn.mockRestore()

const isRide = (s: { kind: string }): s is RideShapeSpan => s.kind === 'ride'
/** Distance from a point to the nearest segment of a polyline. */
function distanceToLine(line: readonly Ground[], p: Ground): number {
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!
    const b = line[i + 1]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 > 0 ? Math.min(Math.max(((p.x - a.x) * dx + (p.z - a.z) * dz) / len2, 0), 1) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)))
  }
  return best
}
const contains = (pattern: readonly string[], run: readonly string[]): boolean =>
  pattern.some((_, at) => run.every((s, i) => pattern[at + i] === s))

describe('the L08 to 127 plan', { timeout: 60_000 }, () => {
  const journeys = route(timetable, ['L08'], ['127'], 28800)
  const changed = journeys.find((j) => j.transfers >= 1)
  const rides = (changed?.legs ?? []).filter((l): l is RideLeg => l.kind === 'ride')

  it('has a journey with a change', () => {
    expect(changed).toBeDefined()
    expect(rides.length).toBeGreaterThanOrEqual(2)
  })

  it.each([
    ['without the hint', unbandedCtx],
    ['with the hint', hintedCtx],
  ])('draws every ride leg on a shape that passes within the offset limit of every stop, %s', (_, ctx) => {
    const spans = journeySpans(changed!.legs, ctx)
    const drawn = spans.filter(isRide)
    expect(drawn).toHaveLength(rides.length)
    for (const s of drawn) {
      expect(s.d1).toBeGreaterThan(s.d0)
      expect(s.matched).not.toBe('other')
      const path = ctx.shapes.find((sh) => sh.id === s.shapeId)!
      const drawnLine = spanPoints(path, s.d0, s.d1)
      for (const stop of (changed!.legs[s.legIndex] as RideLeg).stops) {
        const at = stopMap.get(stop)!.pos
        expect(distanceToLine(drawnLine, at), `${stop} on ${s.shapeId}`).toBeLessThanOrEqual(MAX_STOP_OFFSET_M)
      }
    }
    expect(spans.every((s) => s.kind !== 'straight')).toBe(true)
  })
})

describe('the trip-index hint', { timeout: 120_000 }, () => {
  const patterns = Object.entries(tripIndex.patterns)
  /** Every 2 and 3 stop run of every pattern: where one shape's pattern holds a run and a parallel shape's may not. */
  const runs = patterns.flatMap(([, p]) =>
    [2, 3].flatMap((len) =>
      Array.from({ length: Math.max(0, p.stops.length - len + 1) }, (_, at) => ({ routeId: p.routeId, stops: p.stops.slice(at, at + len) })),
    ),
  )

  it('resolves every pattern whole to a shape whose pattern holds it', () => {
    for (const [shapeId, p] of patterns) {
      const span = rideSpan({ routeId: p.routeId, stops: p.stops }, 0, hintedCtx)
      expect(span.kind, `pattern ${shapeId}`).toBe('ride')
      const ride = span as RideShapeSpan
      expect(ride.matched, `pattern ${shapeId}`).toBe('pattern')
      expect(contains(tripIndex.patterns[ride.shapeId]!.stops, p.stops), `pattern ${shapeId} on ${ride.shapeId}`).toBe(true)
    }
  })

  it('banding the shapes keeps each run on its shape and moves its ends under a metre', () => {
    expect(runs.length).toBeGreaterThan(10_000)
    let worst = 0
    for (const leg of runs) {
      const a = rideSpan(leg, 0, hintedCtx)
      const b = rideSpan(leg, 0, bandedCtx)
      expect(a.kind, leg.stops.join('>')).toBe('ride')
      expect(b, leg.stops.join('>')).toMatchObject({ kind: 'ride', shapeId: (a as RideShapeSpan).shapeId })
      const [x, y] = [a as RideShapeSpan, b as RideShapeSpan]
      worst = Math.max(worst, Math.abs(x.d0 - y.d0), Math.abs(x.d1 - y.d1))
    }
    expect(worst).toBeLessThan(1)
  })

  it('resolves some runs to a different shape than geometry alone, and only where the geometry pick lacks the run', () => {
    let differ = 0
    for (const leg of runs) {
      const hinted = rideSpan(leg, 0, hintedCtx)
      expect(hinted.kind, leg.stops.join('>')).toBe('ride')
      const plain = rideSpan(leg, 0, unbandedCtx)
      if (plain.kind !== 'ride' || plain.shapeId === (hinted as RideShapeSpan).shapeId) continue
      differ++
      expect(contains(tripIndex.patterns[plain.shapeId]!.stops, leg.stops), `${leg.stops.join('>')} unhinted ${plain.shapeId}`).toBe(false)
    }
    expect(differ).toBeGreaterThan(0)
    expect(differ / runs.length).toBeLessThan(0.5)
  })
})
