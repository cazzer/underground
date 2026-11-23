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
import { journeySpans, MAX_STOP_OFFSET_M, rideSpan, stopStations, type RideShapeSpan, type SpanContext, type SpanLeg } from './tripSpans'

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
  ])('draws every ride leg on a shape within the offset limit, %s', (_, ctx) => {
    const spans = journeySpans(changed!.legs as SpanLeg[], ctx)
    const drawn = spans.filter(isRide)
    expect(drawn).toHaveLength(rides.length)
    for (const s of drawn) {
      expect(s.d1).toBeGreaterThan(s.d0)
      expect(s.maxOffsetM).toBeLessThanOrEqual(MAX_STOP_OFFSET_M)
      expect(s.matched).not.toBe('other')
    }
    expect(spans.every((s) => s.kind !== 'straight')).toBe(true)
  })

  it('draws the same spans on the banded shapes', () => {
    const plain = journeySpans(changed!.legs as SpanLeg[], hintedCtx)
    const withBands = journeySpans(changed!.legs as SpanLeg[], bandedCtx)
    expect(withBands).toHaveLength(plain.length)
    plain.forEach((a, i) => {
      const b = withBands[i]!
      if (!isRide(a) || !isRide(b)) return expect(b.kind).toBe(a.kind)
      expect(b.shapeId).toBe(a.shapeId)
      expect(b.d0).toBeCloseTo(a.d0, 6)
      expect(b.d1).toBeCloseTo(a.d1, 6)
    })
  })
})

describe('the trip-index hint', { timeout: 120_000 }, () => {
  const patterns = Object.entries(tripIndex.patterns)

  it('resolves every pattern whole to a shape whose pattern holds it', () => {
    for (const [shapeId, p] of patterns) {
      const span = rideSpan({ routeId: p.routeId, stops: p.stops }, 0, hintedCtx)
      expect(span.kind, `pattern ${shapeId}`).toBe('ride')
      const ride = span as RideShapeSpan
      expect(ride.matched, `pattern ${shapeId}`).toBe('pattern')
      expect(contains(tripIndex.patterns[ride.shapeId]!.stops, p.stops), `pattern ${shapeId} on ${ride.shapeId}`).toBe(true)
    }
  })

  it('resolves some contiguous runs differently than geometry alone', () => {
    let runs = 0
    let differ = 0
    for (const [, p] of patterns) {
      for (let at = 0; at + 3 <= p.stops.length; at += 4) {
        const leg = { routeId: p.routeId, stops: p.stops.slice(at, at + 3) }
        const hinted = rideSpan(leg, 0, hintedCtx)
        const plain = rideSpan(leg, 0, unbandedCtx)
        runs++
        if (hinted.kind !== 'ride' || plain.kind !== 'ride' || hinted.shapeId !== plain.shapeId) differ++
      }
    }
    expect(runs).toBeGreaterThan(500)
    expect(differ).toBeGreaterThan(0)
    expect(differ / runs).toBeLessThan(0.5)
  })
})
