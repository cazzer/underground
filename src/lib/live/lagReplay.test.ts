// Train lag on recorded polls (underground-d80): replays src/test-fixtures/rt-polls.json through the client's own
// per-poll and per-frame code (prepareTrips, reconcileSlots, stepSlot at 30 fps) and times when each dot reaches a
// stop against when the feed first reported the train STOPPED_AT there. The static data is the subset these trips
// need, cut from public/data when the polls were recorded (rt-static.json), so schedule refreshes can't move it.
import { describe, expect, it } from 'vitest'
import pollsRaw from '../../test-fixtures/rt-polls.json?raw'
import staticRaw from '../../test-fixtures/rt-static.json?raw'
import { FEED_IDS, type FeedId, type RealtimeSnapshot } from '../../data/realtime'
import type { ShapesFile, StationsFile, TripIndexFile } from '../../data/schema'
import { pointAtDistance } from '../realtime/polyline'
import { hopDistance } from '../realtime/position'
import { prepareTrips, type LiveTrip, type StaticRealtimeData, type TripMemory } from '../realtime/prepareTrips'
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

const fixed = JSON.parse(staticRaw) as {
  shapes: ShapesFile
  stations: StationsFile
  tripIndex: TripIndexFile
  segments: Record<string, number>
}
const data: StaticRealtimeData = {
  lookup: buildTripLookup(fixed.tripIndex, fixed.shapes),
  geometries: buildShapeGeometries(fixed.shapes, fixed.tripIndex, fixed.stations, TRACK_OFFSET_M, new Map()),
  segments: fixed.segments,
}
const polls = (JSON.parse(pollsRaw) as { polls: RecordedPoll[] }).polls

const FRAME_S = 1 / 30
/** A dot this close to a stop has reached it (a dot's radius at street zoom). */
const REACH_M = 5
/** Only stops the dot was already drawn this long before are timed (it needs a plan to be late against). */
const DRAWN_BEFORE_S = 60
const MAX_STEP_M = 50
/** How far past a platform a dot may get while the next poll still has the train there. */
const PAST_PLATFORM_M = 50

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
  /** The furthest a dot got past a platform between two polls that both have the train at it. */
  maxPastPlatformM: number
}

/**
 * Trips at a platform in poll `k` that are still there in the next one, by key: the distance of that stop on
 * their shape. "At the platform" is STOPPED_AT with the stop's own time at or after the feed header; B-division
 * STOPPED_AT lingers after departure, so a bare status proves nothing there.
 */
function stillAtPlatform(k: number, trips: readonly LiveTrip[]): Map<string, number> {
  const out = new Map<string, number>()
  const next = polls[k + 1]?.snapshot
  if (!next) return out
  const at = (feed: FeedId, tripId: string, stopId: string) => {
    const f = next.feeds[feed]
    const t = f.trips.find((x) => x.tripId === tripId)
    const own = t?.arrivals.find((a) => a[0] === stopId)?.[1]
    return t?.status === 'STOPPED_AT' && t.stopId === stopId && own !== undefined && f.headerTimestamp !== null && own >= f.headerTimestamp
  }
  for (const t of trips) {
    const s = t.trip.stopId === null ? -1 : t.geometry.stops.indexOf(t.trip.stopId)
    if (t.trip.status === 'STOPPED_AT' && s >= 0 && at(t.feed, t.trip.tripId, t.trip.stopId!)) out.set(t.key, t.geometry.stopDistances[s]!)
  }
  return out
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
  let maxPastPlatformM = 0
  let held = new Map<string, number>()
  const end = polls[polls.length - 1]!.receivedAt + 30
  for (let wall = polls[0]!.receivedAt; wall < end; wall += FRAME_S) {
    const perfMs = (wall - perf0) * 1000
    const localS = perfMs / 1000
    while (next < polls.length && polls[next]!.receivedAt <= wall) {
      const p = polls[next++]!
      offset = updateClockOffset(offset, p.snapshot.generatedAt, (p.receivedAt - perf0) * 1000)
      const { trips } = prepareTrips(p.snapshot, data, clockNow(offset, perfMs), previous)
      previous = new Map(trips.map((t) => [t.key, t]))
      held = stillAtPlatform(next - 1, trips)
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
      const platform = held.get(trip.key)
      if (platform !== undefined && scale > 0 && g === trip.geometry) maxPastPlatformM = Math.max(maxPastPlatformM, shown - platform)
      if (table.phase[i] === 1) continue
      for (let s = 0; s < g.stops.length && g.stopDistances[s]! - REACH_M <= shown; s++) {
        const k = `${trip.key}|${g.stops[s]}`
        if (!reached.has(k)) reached.set(k, wall)
      }
    }
  }
  return { reached, firstDrawn, maxStepM, maxBackM, maxPastPlatformM }
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

  it('shows a train reaching its stop within 15 s (median) and 30 s (p90) of the feed, and not 15 s early (p10)', () => {
    // The feed itself is seen about 15 s late (its own ~20 s header cadence plus the 20 s poll).
    expect(quantile(lags, 0.5)).toBeLessThanOrEqual(15)
    expect(quantile(lags, 0.9)).toBeLessThanOrEqual(30)
    expect(quantile(lags, 0.1)).toBeGreaterThanOrEqual(-15)
  })

  it(`keeps a dot within ${PAST_PLATFORM_M} m of a platform the next poll still has the train at`, () => {
    expect(run.maxPastPlatformM).toBeLessThanOrEqual(PAST_PLATFORM_M)
  })

  it(`never moves a visible dot more than ${MAX_STEP_M} m in one frame, or backward`, () => {
    expect(run.maxStepM).toBeLessThanOrEqual(MAX_STEP_M)
    expect(run.maxBackM).toBeLessThanOrEqual(0.01)
  })
})
