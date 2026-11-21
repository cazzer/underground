import { STALE_AFTER_S, type FeedId, type RealtimeSnapshot } from '../../data/realtime'
import type { RouteId } from '../../data/schema'

/**
 * Which realtime feed carries each route in routes.json. The Worker keys feeds, not routes, so this is the
 * client's own table (it mirrors the MTA's feed split); the test checks it covers every route in the data.
 */
export const ROUTE_FEED: Readonly<Record<RouteId, FeedId>> = {
  '1': '1234567', '2': '1234567', '3': '1234567', '4': '1234567', '5': '1234567', '6': '1234567', '6X': '1234567',
  '7': '1234567', '7X': '1234567', GS: '1234567',
  A: 'ace', C: 'ace', E: 'ace', H: 'ace', FS: 'ace',
  B: 'bdfm', D: 'bdfm', F: 'bdfm', FX: 'bdfm', M: 'bdfm',
  G: 'g',
  J: 'jz', Z: 'jz',
  N: 'nqrw', Q: 'nqrw', R: 'nqrw', W: 'nqrw',
  L: 'l',
  SI: 'si',
}

export interface StationFeedHealth {
  /** Routes at the station whose feed failed outright: it has no trips to show, so absence means nothing. */
  unavailable: RouteId[]
  /** Some data for this station is old: a feed serving it is stale, or the whole snapshot is old or failing. */
  delayed: boolean
}

/**
 * Whether the feeds that serve a station's routes can be trusted. A feed with an error has `trips: []`, so an
 * empty list there is not "no trains". Feeds that do not serve the station are ignored.
 */
export function stationFeedHealth(
  snapshot: RealtimeSnapshot,
  routeIds: readonly RouteId[],
  failures: number,
  nowS: number,
): StationFeedHealth {
  const unavailable: RouteId[] = []
  let delayed = failures >= 2 || nowS - snapshot.generatedAt > STALE_AFTER_S
  for (const route of routeIds) {
    const feed = ROUTE_FEED[route]
    if (feed === undefined) continue
    const f = snapshot.feeds[feed]
    if (f.error !== null) unavailable.push(route)
    else if (f.stale) delayed = true
  }
  return { unavailable, delayed }
}
