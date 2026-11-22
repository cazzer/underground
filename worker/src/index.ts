import { ENE_TTL_MS, RT_TTL_MS } from './cache'
import { PREFLIGHT_HEADERS, corsHeaders } from './cors'
import { transformEne } from './ene'
import { ENE_SCHEMA_VERSION, RT_SCHEMA_VERSION, FEED_IDS, type FeedId, type RealtimeSnapshot } from './schema'
import { fetchGeoSearch, fetchPhoton } from './geocodeUpstream'
import { serveCached, type CachedRoute } from './serveCached'
import { createGeocodeState, serveGeocode } from './serveGeocode'
import { buildSnapshot, type FeedOutcome } from './transform'
import { fetchAllFeeds, fetchEne } from './upstream'

function logMiss(request: Request, snapshot: RealtimeSnapshot, outcomes: Record<FeedId, FeedOutcome>): void {
  const feeds = FEED_IDS.map((id) => ({ id, ...snapshot.feeds[id] }))
  // Read by Workers Logs to check "at most one upstream fetch per 15 s per colo".
  console.log(
    JSON.stringify({
      event: 'rt-miss',
      colo: request.cf?.colo,
      errors: feeds.flatMap((f) => (f.error === null ? [] : [{ feed: f.id, error: f.error }])),
      // Upstream cf-cache-status per feed: shows whether cross-isolate dedupe works.
      upstreamCache: Object.fromEntries(FEED_IDS.map((id) => [id, outcomes[id].cacheStatus ?? null])),
      dropped: feeds.reduce((sum, f) => sum + f.droppedEntities, 0),
      emptyRoute: feeds.reduce((sum, f) => sum + f.trips.filter((t) => t.route === '').length, 0),
    }),
  )
}

const rtRoute: CachedRoute = {
  cachePath: `/rt?v=${RT_SCHEMA_VERSION}`,
  ttlMs: RT_TTL_MS,
  async build(request) {
    const outcomes = await fetchAllFeeds()
    // Taken after the fetches: Workers' clock only advances on I/O.
    const snapshot = buildSnapshot(outcomes, Math.floor(Date.now() / 1000))
    logMiss(request, snapshot, outcomes)
    return JSON.stringify(snapshot)
  },
  state: { memo: null, refreshingSince: null, failedUntil: null },
}

const eneRoute: CachedRoute = {
  cachePath: `/ene?v=${ENE_SCHEMA_VERSION}`,
  ttlMs: ENE_TTL_MS,
  async build(request) {
    const upstream = await fetchEne()
    if (!upstream.ok) throw new Error(`ene upstream: ${upstream.error}`)
    // Taken after the fetch: Workers' clock only advances on I/O.
    const { snapshot, upcoming, duplicates } = transformEne(upstream.json, Math.floor(Date.now() / 1000))
    // A jump in `dropped` is how an upstream format change shows up.
    console.log(
      JSON.stringify({
        event: 'ene-miss',
        colo: request.cf?.colo,
        outages: snapshot.outages.length,
        dropped: snapshot.dropped,
        upcoming,
        duplicates,
        upstreamCache: upstream.cacheStatus,
      }),
    )
    return JSON.stringify(snapshot)
  },
  state: { memo: null, refreshingSince: null, failedUntil: null },
}

type Handler = (request: Request, ctx: ExecutionContext, origin: string | null) => Promise<Response>

const geocodeDeps = { fetchGeoSearch, fetchPhoton, state: createGeocodeState(Date.now()) }

const HANDLERS = new Map<string, Handler>([
  ['/rt', (request, ctx, origin) => serveCached(rtRoute, request, ctx, origin, caches.default)],
  ['/ene', (request, ctx, origin) => serveCached(eneRoute, request, ctx, origin, caches.default)],
  ['/geocode', (request, ctx, origin) => serveGeocode(request, ctx, origin, caches.default, geocodeDeps)],
])

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    const handler = HANDLERS.get(new URL(request.url).pathname)
    if (!handler) return new Response('Not found', { status: 404 })
    const origin = request.headers.get('Origin')
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(origin), ...PREFLIGHT_HEADERS } })
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, OPTIONS' } })
    }
    try {
      return await handler(request, ctx, origin)
    } catch (e) {
      // serveGeocode never throws, so no geocode error (whose text could hold the query) reaches this log.
      console.error(e)
      return new Response('{"error":"internal"}', {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
      })
    }
  },
} satisfies ExportedHandler
