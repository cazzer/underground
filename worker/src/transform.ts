import type { transit_realtime } from './gen/subway-rt.js'
import {
  ARRIVAL_HORIZON_S,
  ARRIVALS_MIN,
  FEED_IDS,
  RT_SCHEMA_VERSION,
  STALE_AFTER_S,
  type Arrival,
  type Direction,
  type FeedId,
  type FeedSnapshot,
  type RealtimeSnapshot,
  type RealtimeTrip,
  type VehicleStatus,
} from './schema'

type Message = transit_realtime.FeedMessage.$Properties
type StopTimeUpdate = transit_realtime.TripUpdate.StopTimeUpdate.$Properties
type TripUpdate = transit_realtime.TripUpdate.$Properties
type Vehicle = transit_realtime.VehiclePosition.$Properties

export type FeedOutcome = { ok: true; message: Message } | { ok: false; error: string }

// uint64/int64 decode to Long objects, which JSON.stringify would emit as {low, high, unsigned}.
export function toSeconds(v: number | { toNumber(): number } | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : v.toNumber()
  return n === 0 ? null : n
}

// NYCT Direction enum: NORTH = 1, SOUTH = 3. Fallback reads the trip_id route segment,
// which is "<origin>_<route>.<dir>" or, for some routes, "<origin>_<route>..<dir>".
export function parseDirection(nyctDirection: number | null | undefined, tripId: string): Direction | null {
  if (nyctDirection === 1) return 'N'
  if (nyctDirection === 3) return 'S'
  const m = /^[^_]*_[^.]*\.{1,2}([NS])/.exec(tripId)
  return m ? (m[1] as Direction) : null
}

const STATUS_BY_CODE: Record<number, VehicleStatus> = { 0: 'INCOMING_AT', 1: 'STOPPED_AT', 2: 'IN_TRANSIT_TO' }

function toStatus(code: number | null | undefined): VehicleStatus {
  return (code === null || code === undefined ? undefined : STATUS_BY_CODE[code]) ?? 'IN_TRANSIT_TO'
}

export function compactArrivals(stus: StopTimeUpdate[], now: number): Arrival[] {
  const out: Arrival[] = []
  for (const stu of stus) {
    const time = toSeconds(stu.arrival?.time) ?? toSeconds(stu.departure?.time)
    if (!stu.stopId || time === null) continue
    if (out.length < ARRIVALS_MIN || time <= now + ARRIVAL_HORIZON_S) out.push([stu.stopId, time])
  }
  return out
}

function compactTrip(tripId: string, tu: TripUpdate | undefined, vp: Vehicle | undefined, now: number): RealtimeTrip {
  const nyct = tu?.trip?.nyctTripDescriptor ?? vp?.trip?.nyctTripDescriptor
  const arrivals = compactArrivals(tu?.stopTimeUpdate ?? [], now)
  return {
    route: tu?.trip?.routeId ?? vp?.trip?.routeId ?? '',
    direction: parseDirection(nyct?.direction, tripId),
    tripId,
    startDate: tu?.trip?.startDate ?? vp?.trip?.startDate ?? null,
    trainId: nyct?.trainId ?? null,
    assigned: nyct?.isAssigned === true,
    stopId: vp ? (vp.stopId ?? null) : (arrivals[0]?.[0] ?? null),
    status: vp ? toStatus(vp.currentStatus) : null,
    timestamp: vp ? toSeconds(vp.timestamp) : null,
    arrivals,
  }
}

/** Joins TripUpdates and VehiclePositions by trip_id; a trip may have either or both. */
export function compactFeed(message: Message, now: number): { trips: RealtimeTrip[]; droppedEntities: number } {
  const joined = new Map<string, { tu?: TripUpdate; vp?: Vehicle }>()
  let droppedEntities = 0
  for (const entity of message.entity ?? []) {
    if (entity.isDeleted) continue
    const tuId = entity.tripUpdate?.trip?.tripId
    const vpId = entity.vehicle?.trip?.tripId
    // Counted once per entity, even when its other half survives.
    if ((entity.tripUpdate && !tuId) || (entity.vehicle && !vpId)) droppedEntities++
    if (entity.tripUpdate && tuId) {
      const slot = joined.get(tuId) ?? {}
      slot.tu ??= entity.tripUpdate
      joined.set(tuId, slot)
    }
    if (entity.vehicle && vpId) {
      const slot = joined.get(vpId) ?? {}
      slot.vp ??= entity.vehicle
      joined.set(vpId, slot)
    }
  }
  const trips = [...joined].map(([tripId, { tu, vp }]) => compactTrip(tripId, tu, vp, now))
  return { trips, droppedEntities }
}

function failedFeed(error: string): FeedSnapshot {
  return { headerTimestamp: null, error, stale: true, droppedEntities: 0, trips: [] }
}

function buildFeed(outcome: FeedOutcome, now: number): FeedSnapshot {
  if (!outcome.ok) return failedFeed(outcome.error)
  const headerTimestamp = toSeconds(outcome.message.header?.timestamp)
  if (headerTimestamp === null) return failedFeed('missing header timestamp')
  try {
    const { trips, droppedEntities } = compactFeed(outcome.message, now)
    return { headerTimestamp, error: null, stale: now - headerTimestamp > STALE_AFTER_S, droppedEntities, trips }
  } catch (e) {
    return failedFeed(`transform failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`)
  }
}

export function buildSnapshot(outcomes: Record<FeedId, FeedOutcome>, now: number): RealtimeSnapshot {
  const feeds = {} as Record<FeedId, FeedSnapshot>
  for (const id of FEED_IDS) feeds[id] = buildFeed(outcomes[id], now)
  return { version: RT_SCHEMA_VERSION, generatedAt: now, feeds }
}
