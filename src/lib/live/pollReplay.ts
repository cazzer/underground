// Replays the recorded `/rt` polls (src/test-fixtures/rt-polls.json) through the client's own per-poll and per-frame
// code, for lagReplay.test.ts and panelReplay.test.ts. The static data is the subset those trips need, cut from
// public/data when the polls were recorded (rt-static.json), so schedule refreshes can't move the numbers.
import pollsRaw from '../../test-fixtures/rt-polls.json?raw'
import staticRaw from '../../test-fixtures/rt-static.json?raw'
import { FEED_IDS, type FeedId, type RealtimeSnapshot } from '../../data/realtime'
import type { ShapesFile, StationsFile, TripIndexFile } from '../../data/schema'
import { pointAtDistance } from '../realtime/polyline'
import { hopDistance } from '../realtime/position'
import { carryMemory, prepareTrips, type CarriedMemory, type LiveTrip, type StaticRealtimeData } from '../realtime/prepareTrips'
import { buildShapeGeometries, type ShapeGeometry } from '../realtime/shapeGeometry'
import { buildTripLookup } from '../realtime/tripLookup'
import { TRACK_OFFSET_M } from '../trackOffset'
import { clockNow, updateClockOffset } from './clock'
import { createSlotTable, FADE_S, freeSlot, isLeaving, reconcileSlots, slotScale, stepSlot, TRAIN_CAPACITY } from './slots'

export interface RecordedPoll {
  /** Wall-clock epoch s the response arrived. */
  receivedAt: number
  snapshot: RealtimeSnapshot
}

export const fixed = JSON.parse(staticRaw) as {
  shapes: ShapesFile
  stations: StationsFile
  tripIndex: TripIndexFile
  segments: Record<string, number>
}
export const data: StaticRealtimeData = {
  lookup: buildTripLookup(fixed.tripIndex, fixed.shapes),
  geometries: buildShapeGeometries(fixed.shapes, fixed.tripIndex, fixed.stations, TRACK_OFFSET_M, new Map()),
  segments: fixed.segments,
}
export const polls = (JSON.parse(pollsRaw) as { polls: RecordedPoll[] }).polls

export const FRAME_S = 1 / 30
/** A dot this close to a stop has reached it (a dot's radius at street zoom). */
export const REACH_M = 5
/** Only stops the dot was already drawn this long before are timed (it needs a plan to be late against). */
export const DRAWN_BEFORE_S = 60
export const MAX_STEP_M = 50
/** How far past a platform a dot may get while the next poll still has the train there. */
export const PAST_PLATFORM_M = 50

export interface Arrival {
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
export function feedArrivals(): Arrival[] {
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

export interface Replay {
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
export function replay(): Replay {
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
  let previous: ReadonlyMap<string, CarriedMemory> = new Map()
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
      previous = carryMemory(previous, trips)
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

export const quantile = (xs: readonly number[], q: number): number => {
  const a = [...xs].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(q * a.length))]!
}

/** The live clock offset after each poll, as the client keeps it (clock.ts), on the replay's own perf clock. */
export function pollClocks(): { receivedAt: number; offset: number }[] {
  const perf0 = polls[0]!.receivedAt - 1
  let offset: number | null = null
  return polls.map((p) => {
    offset = updateClockOffset(offset, p.snapshot.generatedAt, (p.receivedAt - perf0) * 1000)
    return { receivedAt: p.receivedAt, offset }
  })
}

/** The client's live time at wall-clock `wall`, given the clock `offset` of the latest poll before it. */
export const liveNowAt = (offset: number, wall: number): number => clockNow(offset, (wall - (polls[0]!.receivedAt - 1)) * 1000)
