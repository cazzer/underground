import { FEED_IDS, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import type { ShapeId } from '../../data/schema'
import { GHOST, ghostReason, type GhostReason } from './filters'
import { joinTrip, type JoinResult, type JoinStage } from './joinTrip'
import { planHop, type HopPlan, type PlanFailure } from './position'
import type { ShapeGeometry } from './shapeGeometry'
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
  /** Shape each trip key was placed on last poll; breaks ties in the fallback join so trips don't flap. */
  previousShapes?: ReadonlyMap<string, ShapeId>,
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
      const join = joinTrip(trip, data.lookup, now, previousShapes?.get(`${feed}:${trip.tripId}`))
      if (!join.matched) {
        dropped[join.reason]++
        continue
      }
      const geometry = data.geometries.get(join.shapeId)
      if (!geometry) throw new Error(`no geometry for joined shape ${join.shapeId}`)

      const plan = planHop({
        geometry,
        status: trip.status,
        stopId: trip.stopId,
        arrivals: trip.arrivals,
        segments: data.segments,
        now,
      })
      if ('ok' in plan) {
        dropped[plan.reason]++
        continue
      }
      if (plan.departsInS !== null && plan.departsInS > GHOST.notDepartedS) {
        dropped['not-departed']++
        continue
      }
      trips.push({ key: `${feed}:${trip.tripId}`, feed, trip, shapeId: join.shapeId, stage: join.stage, geometry, plan })
    }
  }
  return { trips, dropped }
}
