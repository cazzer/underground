// The realtime JSON contract lives in worker/src/schema.ts; the client only re-exports it.
export type {
  Arrival,
  Direction,
  FeedId,
  FeedSnapshot,
  RealtimeSnapshot,
  RealtimeTrip,
  VehicleStatus,
} from '../../worker/src/schema'
export {
  ARRIVAL_HORIZON_S,
  ARRIVALS_MIN,
  FEED_IDS,
  RT_SCHEMA_VERSION,
  STALE_AFTER_S,
} from '../../worker/src/schema'

/** Worker endpoint, e.g. http://localhost:8787/rt from `wrangler dev`. Null when unset or empty. */
export const RT_URL: string | null = import.meta.env.VITE_RT_URL || null
