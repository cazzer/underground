import { FEED_IDS, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import type { ShapeId, StopId } from '../../data/schema'
import { ARRIVAL_SHIFT_S } from './arrivalShift'
import { GHOST, ghostReason, type GhostReason } from './filters'
import { joinTrip, type JoinResult, type JoinStage } from './joinTrip'
import { planHop, type HopPlan, type PlanFailure } from './position'
import type { ShapeGeometry } from './shapeGeometry'
import { nextVisit, type StopVisit } from './stopVisit'
import type { TripLookup } from './tripLookup'

export interface StaticRealtimeData {
  lookup: TripLookup
  geometries: ReadonlyMap<ShapeId, ShapeGeometry>
  segments: Readonly<Record<string, number>>
}

export interface LiveTrip {
  /** Stable across polls: `${feed}:${tripId}`. */
  key: string
  feed: FeedId
  trip: RealtimeTrip
  shapeId: ShapeId
  stage: JoinStage
  geometry: ShapeGeometry
  /** The hop as of this poll; evaluate it per frame with `hopDistance`. */
  plan: HopPlan
  /** The last stop the train was seen at, carried to the next poll. */
  visit: StopVisit | null
  /**
   * The trip's own first stop: its shape's first when the join found its own pattern, else (a short turn on the
   * route's primary, say) the first stop it was seen at, carried across polls.
   */
  origin: StopId | null
}

/** What a trip carries from one poll to the next. */
export type TripMemory = Pick<LiveTrip, 'shapeId' | 'visit' | 'origin'>

/** A trip missing from this many polls in a row (a feed gap, a ghost-filter blip) still keeps its memory. */
export const MEMORY_TTL_POLLS = 1

export interface CarriedMemory extends TripMemory {
  /** Polls in a row the trip has been missing. */
  missedPolls: number
}

/** The memory to pass the next poll: this poll's trips, plus last poll's for trips missing up to the TTL. */
export function carryMemory(previous: ReadonlyMap<string, CarriedMemory>, trips: readonly LiveTrip[]): Map<string, CarriedMemory> {
  const out = new Map<string, CarriedMemory>()
  for (const t of trips) out.set(t.key, { shapeId: t.shapeId, visit: t.visit, origin: t.origin, missedPolls: 0 })
  for (const [key, m] of previous) {
    if (!out.has(key) && m.missedPolls < MEMORY_TTL_POLLS) out.set(key, { ...m, missedPolls: m.missedPolls + 1 })
  }
  return out
}

export interface PreparedTrips {
  trips: LiveTrip[]
  dropped: Record<DropReason, number>
}

type JoinFailure = Extract<JoinResult, { matched: false }>['reason']
type PositionFailure = PlanFailure['reason']

/** Every reason a trip can be dropped. The type is derived from this list, and `satisfies` keeps it to known reasons. */
const DROP_REASONS = [
  'unassigned',
  'stale-vehicle',
  'no-future-arrival',
  'unparseable-id',
  'unknown-route',
  'off-pattern',
  'no-arrival',
  'not-departed',
] as const satisfies readonly (GhostReason | JoinFailure | PositionFailure | 'not-departed')[]

export type DropReason = (typeof DROP_REASONS)[number]

/**
 * Once per poll: drops ghosts, joins each remaining trip to a shape, and drops what can't be placed.
 * Every drop is counted by reason. The caller then runs hopDistance per frame on each trip's plan.
 */
export function prepareTrips(
  snapshot: RealtimeSnapshot,
  data: StaticRealtimeData,
  now: number,
  /**
   * Last poll's trips by key: the shape breaks ties in the fallback join so trips don't flap, and the visit
   * carries the last stop seen into this poll's plan.
   */
  previous?: ReadonlyMap<string, TripMemory>,
): PreparedTrips {
  const dropped = Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>
  const trips: LiveTrip[] = []

  for (const feed of FEED_IDS) {
    for (const trip of snapshot.feeds[feed].trips) {
      const ghost = ghostReason(trip, now)
      if (ghost) {
        dropped[ghost]++
        continue
      }
      const key = `${feed}:${trip.tripId}`
      const before = previous?.get(key)
      const join = joinTrip(trip, data.lookup, now, before?.shapeId)
      if (!join.matched) {
        dropped[join.reason]++
        continue
      }
      const geometry = data.geometries.get(join.shapeId)
      if (!geometry) throw new Error(`no geometry for joined shape ${join.shapeId}`)

      const visit = nextVisit(before?.visit ?? null, trip, feed, snapshot.feeds[feed].headerTimestamp)
      const origin =
        join.stage === 'primary'
          ? (before?.origin ?? (trip.status === 'STOPPED_AT' ? trip.stopId : (trip.arrivals[0]?.[0] ?? null)))
          : geometry.stops[0]!
      const plan = planHop({
        geometry,
        status: trip.status,
        stopId: trip.stopId,
        arrivals: trip.arrivals,
        segments: data.segments,
        now,
        visit,
        origin,
        arrivalShiftS: ARRIVAL_SHIFT_S[feed],
      })
      if ('ok' in plan) {
        dropped[plan.reason]++
        continue
      }
      if (plan.departsInS !== null && plan.departsInS > GHOST.notDepartedS) {
        dropped['not-departed']++
        continue
      }
      trips.push({ key, feed, trip, shapeId: join.shapeId, stage: join.stage, geometry, plan, visit, origin })
    }
  }
  return { trips, dropped }
}
