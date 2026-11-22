/** Bump on incompatible shape changes; also part of the edge cache key. */
export const RT_SCHEMA_VERSION = 1
/** Arrivals later than generatedAt + this are omitted (but see ARRIVALS_MIN). */
export const ARRIVAL_HORIZON_S = 1800
/** Every trip keeps at least its first N stop-time updates, regardless of horizon. */
export const ARRIVALS_MIN = 2
/** A feed whose header is older than this (relative to generatedAt) is stale. */
export const STALE_AFTER_S = 90

export const FEED_IDS = ['1234567', 'ace', 'bdfm', 'g', 'jz', 'nqrw', 'l', 'si'] as const
export type FeedId = (typeof FEED_IDS)[number]

export type Direction = 'N' | 'S'
export type VehicleStatus = 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO'

/** [directional child stop_id e.g. "L26S", predicted epoch seconds: arrival.time, else departure.time] */
export type Arrival = [stopId: string, time: number]

export interface RealtimeTrip {
  route: string                 // TripDescriptor.route_id, raw ("L", "GS", "7X", "SI", "W")
  direction: Direction | null   // NYCT direction (NORTH->N, SOUTH->S), else parsed from trip_id
  tripId: string                // realtime trip_id, raw: single-dot forms ("126600_SI.S03R") untouched
  startDate: string | null      // TripDescriptor.start_date, YYYYMMDD; null if absent
  trainId: string | null        // NYCT train_id, raw ("1SI 2106 STG/TNV")
  assigned: boolean             // NYCT is_assigned (false/absent -> false)
  stopId: string | null         // VehiclePosition.stop_id; when no VehiclePosition, first arrival's stop
  status: VehicleStatus | null  // null only when no VehiclePosition; unset current_status -> IN_TRANSIT_TO
  timestamp: number | null      // VehiclePosition.timestamp, epoch s; null when no VehiclePosition
  arrivals: Arrival[]           // feed order; index < ARRIVALS_MIN || time <= generatedAt + ARRIVAL_HORIZON_S
}

export interface FeedSnapshot {
  headerTimestamp: number | null  // FeedHeader.timestamp, epoch s; null when the feed failed
  error: string | null            // "HTTP 503", "timeout after 5000 ms", "decode failed: …", "missing header timestamp"
  stale: boolean                  // error !== null || generatedAt - headerTimestamp > STALE_AFTER_S
  droppedEntities: number         // entities skipped for lacking trip.trip_id (never observed; reported, not silent)
  trips: RealtimeTrip[]           // [] when error
}

export interface RealtimeSnapshot {
  version: typeof RT_SCHEMA_VERSION
  generatedAt: number             // epoch s, set by the Worker after the fetches settle
  feeds: Record<FeedId, FeedSnapshot>
}

/** Bump on incompatible shape changes to the /ene body; also part of its edge cache key. */
export const ENE_SCHEMA_VERSION = 1

export interface EneOutage {
  code: string            // equipment code ("EL358"), join key to interior Connector.id
  reason: string | null   // trimmed, capped at 100 chars; empty or non-string -> null
  since: number           // outagedate, epoch s
  returnAt: number | null // estimatedreturntoservice, epoch s; empty or unparseable -> null (may be past: overdue)
}

export interface EneSnapshot {
  version: typeof ENE_SCHEMA_VERSION
  generatedAt: number     // epoch s, set by the Worker after the fetch settles
  dropped: number         // malformed rows skipped
  outages: EneOutage[]    // in effect at generatedAt, one per code, sorted by code
}
