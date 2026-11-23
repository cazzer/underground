// The realtime JSON contract lives in worker/src/schema.ts; the client only re-exports it (and the /geocode contract below).
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

export type { AlertEntity, AlertPeriod, AlertsSnapshot, ServiceAlert } from '../../worker/src/schema'
export { ALERT_WINDOW_S, ALERTS_SCHEMA_VERSION } from '../../worker/src/schema'

export type { GeocodeKind, GeocodeResponse, GeocodeResult, GeocodeSource, UpstreamSource } from '../../worker/src/schema'
export { GEOCODE_ATTRIBUTION, GEOCODE_KINDS, GEOCODE_MAX_RESULTS, GEOCODE_SCHEMA_VERSION, GEOCODE_SOURCES } from '../../worker/src/schema'
// The query normalizer and the bbox come from the Worker too, so the client's minimum length and cache key agree with it.
export { NYC_BBOX, normalizeQuery } from '../../worker/src/geocodeQuery'

/**
 * A Worker route that is a sibling of the /rt URL. The client talks only to the Worker, never an MTA host
 * (the MTA terms require a non-MTA host), so a URL on mta.info gives null, as does one that doesn't parse;
 * both are logged, with `off` saying what is then off.
 */
function workerSiblingUrl(rtUrl: string, path: 'ene' | 'alerts' | 'geocode', off: string): string | null {
  try {
    // A trailing slash on the /rt URL (`/rt/`) would make the sibling `/rt/ene`.
    const base = new URL(rtUrl)
    base.pathname = base.pathname.replace(/\/+$/, '')
    const url = new URL(path, base)
    if (url.hostname === 'mta.info' || url.hostname.endsWith('.mta.info')) {
      console.error(`VITE_RT_URL points at an MTA host (${url.hostname}); ${off}: the client only uses the Worker`)
      return null
    }
    return url.href
  } catch (err) {
    console.error(`VITE_RT_URL is not a URL, so ${off}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** The Worker's /ene route. */
export const eneUrlFrom = (rtUrl: string): string | null => workerSiblingUrl(rtUrl, 'ene', 'outages are off')

/** The Worker's /alerts route (the MTA's subway service alerts). */
export const alertsUrlFrom = (rtUrl: string): string | null => workerSiblingUrl(rtUrl, 'alerts', 'service changes are off')

/** The Worker's /geocode route (address and place search). */
export const geocodeUrlFrom = (rtUrl: string): string | null => workerSiblingUrl(rtUrl, 'geocode', 'address search is off')

/** The outage endpoint, e.g. http://localhost:8787/ene. Null with no `RT_URL`. */
export const ENE_URL: string | null = RT_URL && eneUrlFrom(RT_URL)

/** The service alerts endpoint, e.g. http://localhost:8787/alerts. Null with no `RT_URL`: nothing is fetched and the panel shows no service changes. */
export const ALERTS_URL: string | null = RT_URL && alertsUrlFrom(RT_URL)

/** The address and place search endpoint, e.g. http://localhost:8787/geocode. Null with no `RT_URL`: the search then finds stations only. */
export const GEOCODE_URL: string | null = RT_URL && geocodeUrlFrom(RT_URL)
