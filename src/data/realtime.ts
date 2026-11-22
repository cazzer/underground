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

export type { EneOutage, EneSnapshot } from '../../worker/src/schema'
export { ENE_SCHEMA_VERSION } from '../../worker/src/schema'

/**
 * The Worker's /ene route, a sibling of the /rt URL. The client talks only to the Worker, never an MTA host
 * (the MTA terms require a non-MTA host), so a URL on mta.info gives null, as does one that doesn't parse;
 * both are logged.
 */
export function eneUrlFrom(rtUrl: string): string | null {
  try {
    const url = new URL('ene', rtUrl)
    if (url.hostname === 'mta.info' || url.hostname.endsWith('.mta.info')) {
      console.error(`VITE_RT_URL points at an MTA host (${url.hostname}); outages are off: the client only uses the Worker`)
      return null
    }
    return url.href
  } catch (err) {
    console.error(`VITE_RT_URL is not a URL, so outages are off: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** The outage endpoint, e.g. http://localhost:8787/ene. Null with no `RT_URL`. */
export const ENE_URL: string | null = RT_URL && eneUrlFrom(RT_URL)
