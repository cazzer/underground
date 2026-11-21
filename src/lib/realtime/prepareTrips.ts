import { FEED_IDS, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import type { ShapeId } from '../../data/schema'
import { GHOST, ghostReason, type GhostReason } from './filters'
import { joinTrip, type JoinStage } from './joinTrip'
import { positionAlongShape } from './position'
import type { ShapeGeometry } from './shapeGeometry'
import type { TripLookup } from './tripLookup'

export type DropReason =
  | GhostReason
  | 'unparseable-id'
  | 'unknown-route'
  | 'off-pattern'
  | 'no-arrival'
  | 'not-departed'

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
}

export interface PreparedTrips {
  trips: LiveTrip[]
  dropped: Record<DropReason, number>
}

const DROP_REASONS: readonly DropReason[] = [
  'unassigned',
  'stale-vehicle',
  'no-future-arrival',
  'unparseable-id',
  'unknown-route',
  'off-pattern',
  'no-arrival',
  'not-departed',
]

/**
 * Once per poll: drops ghosts, joins each remaining trip to a shape, and drops what can't be placed.
 * Every drop is counted by reason. The caller then runs positionAlongShape per frame on `trips`.
 */
export function prepareTrips(snapshot: RealtimeSnapshot, data: StaticRealtimeData, now: number): PreparedTrips {
  const dropped = Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>
  const trips: LiveTrip[] = []

  for (const feed of FEED_IDS) {
    for (const trip of snapshot.feeds[feed].trips) {
      const ghost = ghostReason(trip, now)
      if (ghost) {
        dropped[ghost]++
        continue
      }
      const join = joinTrip(trip, data.lookup, now)
      if (!join.matched) {
        dropped[join.reason]++
        continue
      }
      const geometry = data.geometries.get(join.shapeId)
      if (!geometry) throw new Error(`no geometry for joined shape ${join.shapeId}`)

      const pos = positionAlongShape({
        geometry,
        status: trip.status,
        stopId: trip.stopId,
        arrivals: trip.arrivals,
        segments: data.segments,
        now,
      })
      if (!pos.ok) {
        dropped[pos.reason]++
        continue
      }
      if (pos.departsInS !== null && pos.departsInS > GHOST.notDepartedS) {
        dropped['not-departed']++
        continue
      }
      trips.push({ key: `${feed}:${trip.tripId}`, feed, trip, shapeId: join.shapeId, stage: join.stage, geometry })
    }
  }
  return { trips, dropped }
}
