// Train lag on recorded polls (underground-d80): replays src/test-fixtures/rt-polls.json through the client's own
// per-poll and per-frame code (prepareTrips, reconcileSlots, stepSlot at 30 fps) and times when each dot reaches a
// stop against when the feed first reported the train STOPPED_AT there. Uses the committed public/data, like
// dwellReplay.test.ts, so it runs in the daily data refresh: a failure there after a new schedule pick may mean
// the recorded trips no longer join, and the fixture needs re-recording (see src/test-fixtures/README.md).
import { describe, expect, it } from 'vitest'
import segmentsRaw from '../../../public/data/segments.json?raw'
import shapesRaw from '../../../public/data/shapes.json?raw'
import stationsRaw from '../../../public/data/stations.json?raw'
import tripIndexRaw from '../../../public/data/trip-index.json?raw'
import pollsRaw from '../../test-fixtures/rt-polls.json?raw'
import { FEED_IDS, type RealtimeSnapshot } from '../../data/realtime'
import type { SegmentsFile, ShapesFile, StationsFile, TripIndexFile } from '../../data/schema'
import { pointAtDistance } from '../realtime/polyline'
import { hopDistance } from '../realtime/position'
import { prepareTrips, type StaticRealtimeData, type TripMemory } from '../realtime/prepareTrips'
import { buildShapeGeometries, type ShapeGeometry } from '../realtime/shapeGeometry'
import { buildTripLookup } from '../realtime/tripLookup'
import { TRACK_OFFSET_M } from '../trackOffset'
import { clockNow, updateClockOffset } from './clock'
import { createSlotTable, FADE_S, freeSlot, isLeaving, reconcileSlots, slotScale, stepSlot, TRAIN_CAPACITY } from './slots'

interface RecordedPoll {
  /** Wall-clock epoch s the response arrived. */
  receivedAt: number
  snapshot: RealtimeSnapshot
}

const shapes = JSON.parse(shapesRaw) as ShapesFile
const stations = JSON.parse(stationsRaw) as StationsFile
const index = JSON.parse(tripIndexRaw) as TripIndexFile
const data: StaticRealtimeData = {
  lookup: buildTripLookup(index, shapes),
  geometries: buildShapeGeometries(shapes, index, stations, TRACK_OFFSET_M, new Map()),
  segments: (JSON.parse(segmentsRaw) as SegmentsFile).segments,
}
const polls = (JSON.parse(pollsRaw) as { polls: RecordedPoll[] }).polls

const FRAME_S = 1 / 30
/** A dot this close to a stop has reached it (a dot's radius at street zoom). */
const REACH_M = 5
/** Only stops the dot was already drawn this long before are timed (it needs a plan to be late against). */
const DRAWN_BEFORE_S = 60
const MAX_STEP_M = 50

interface Arrival {
  key: string
  stopId: string
  /** Epoch s the train reached the stop by the feed. */
  at: number
}

/**
 * The feed's arrivals: a trip that turns STOPPED_AT a stop it had a prediction for a poll earlier. Its time is the
 * VehiclePosition time when that falls between the two feed headers (the L feed's doesn't mark the arrival), else
 * the headers' midpoint.
 */
function feedArrivals(): Arrival[] {
  const out: Arrival[] = []
  for (let k = 1; k < polls.length; k++) {
    for (const feed of FEED_IDS) {
      const before = polls[k - 1]!.snapshot.feeds[feed]
      const now = polls[k]!.snapshot.feeds[feed]
      if (before.headerTimestamp === null || now.headerTimestamp === null || before.headerTimestamp === now.headerTimestamp) continue
      for (const t of now.trips) {
        const p = before.trips.find((x) => x.tripId === t.tripId)
        if (!p || t.status !== 'STOPPED_AT' || t.stopId === null) continue
        if (p.status === 'STOPPED_AT' && p.stopId === t.stopId) continue
        if (!p.arrivals.some((a) => a[0] === t.stopId)) continue
        const ts = t.timestamp
        const vpOk = feed !== 'l' && ts !== null && ts > before.headerTimestamp && ts <= now.headerTimestamp
        out.push({ key: `${feed}:${t.tripId}`, stopId: t.stopId, at: vpOk ? ts : (before.headerTimestamp + now.headerTimestamp) / 2 })
      }
    }
  }
  return out
}

interface Replay {
  /** `${key}|${stopId}` → wall-clock epoch s the dot first reached the stop. */
  reached: Map<string, number>
  firstDrawn: Map<string, number>
  maxStepM: number
  maxBackM: number
}

/** Runs the polls through the client's code frame by frame, the way LiveTrains does. */
function replay(): Replay {
  const perf0 = polls[0]!.receivedAt - 1
  const table = createSlotTable(TRAIN_CAPACITY)
  const reached = new Map<string, number>()
  const firstDrawn = new Map<string, number>()
  // Last frame's drawn point, distance and shape per slot; x NaN means not drawn.
  const last = {
    x: new Float64Array(TRAIN_CAPACITY).fill(NaN),
    z: new Float64Array(TRAIN_CAPACITY),
    d: new Float64Array(TRAIN_CAPACITY),
    g: new Array<ShapeGeometry | null>(TRAIN_CAPACITY).fill(null),
  }
  let previous: ReadonlyMap<string, TripMemory> = new Map()
  let offset: number | null = null
  let next = 0
  let maxStepM = 0
  let maxBackM = 0
  const end = polls[polls.length - 1]!.receivedAt + 30
  for (let wall = polls[0]!.receivedAt; wall < end; wall += FRAME_S) {
    const perfMs = (wall - perf0) * 1000
    const localS = perfMs / 1000
    while (next < polls.length && polls[next]!.receivedAt <= wall) {
      const p = polls[next++]!
      offset = updateClockOffset(offset, p.snapshot.generatedAt, (p.receivedAt - perf0) * 1000)
      const { trips } = prepareTrips(p.snapshot, data, clockNow(offset, perfMs), previous)
      previous = new Map(trips.map((t) => [t.key, t]))
      reconcileSlots(table, trips, localS, { dataNow: clockNow(offset, perfMs), reducedMotion: false })
      for (const t of trips) if (!firstDrawn.has(t.key)) firstDrawn.set(t.key, wall)
    }
    if (offset === null) continue
    const now = clockNow(offset, perfMs)
    for (let i = 0; i < table.high; i++) {
      const trip = table.trips[i]
      if (!trip) continue
      const shown = stepSlot(table, i, hopDistance(trip.plan, trip.geometry, now), now, localS, FRAME_S)
      const scale = slotScale(table, i, localS, FADE_S)
      if (scale === 0 && isLeaving(table, i)) {
        freeSlot(table, i)
        last.x[i] = NaN
        continue
      }
      const g = table.drawGeometry[i]!
      const { point } = pointAtDistance(g.line, shown)
      // A visible dot (any scale above 0) never jumps or steps back between frames.
      if (scale > 0 && !Number.isNaN(last.x[i]!)) {
        maxStepM = Math.max(maxStepM, Math.hypot(point.x - last.x[i]!, point.z - last.z[i]!))
        if (g === last.g[i]) maxBackM = Math.max(maxBackM, last.d[i]! - shown)
      }
      last.x[i] = scale > 0 ? point.x : NaN
      last.z[i] = point.z
      last.d[i] = shown
      last.g[i] = g
      if (table.phase[i] === 1) continue
      for (let s = 0; s < g.stops.length && g.stopDistances[s]! - REACH_M <= shown; s++) {
        const k = `${trip.key}|${g.stops[s]}`
        if (!reached.has(k)) reached.set(k, wall)
      }
    }
  }
  return { reached, firstDrawn, maxStepM, maxBackM }
}

const quantile = (xs: readonly number[], q: number): number => {
  const a = [...xs].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(q * a.length))]!
}

describe('replaying recorded polls', () => {
  const run = replay()
  const lags = feedArrivals().flatMap((e) => {
    const born = run.firstDrawn.get(e.key)
    const at = run.reached.get(`${e.key}|${e.stopId}`)
    return born === undefined || born > e.at - DRAWN_BEFORE_S || at === undefined ? [] : [at - e.at]
  })

  it('times enough arrivals across the A, B and L divisions', () => {
    expect(lags.length).toBeGreaterThanOrEqual(25)
  })

  it('shows a train reaching its stop within 15 s (median) and 30 s (p90) of the feed', () => {
    // The feed itself is seen about 15 s late (its own ~20 s header cadence plus the 20 s poll).
    expect(quantile(lags, 0.5)).toBeLessThanOrEqual(15)
    expect(quantile(lags, 0.9)).toBeLessThanOrEqual(30)
  })

  it(`never moves a visible dot more than ${MAX_STEP_M} m in one frame, or backward`, () => {
    expect(run.maxStepM).toBeLessThanOrEqual(MAX_STEP_M)
    expect(run.maxBackM).toBeLessThanOrEqual(0.01)
  })
})
