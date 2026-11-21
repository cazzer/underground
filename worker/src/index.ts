import { TTL_MS, cacheDecision, type CacheDecision, type Memo } from './cache'
import { PREFLIGHT_HEADERS, corsHeaders } from './cors'
import { RT_SCHEMA_VERSION, FEED_IDS, type FeedId, type RealtimeSnapshot } from './schema'
import { buildSnapshot, type FeedOutcome } from './transform'
import { fetchAllFeeds } from './upstream'

type CacheState = Exclude<CacheDecision, 'busy' | 'refresh'> | 'edge' | 'miss'

// Resolved values only: Workers can hang on promises shared across requests.
let memo: Memo | null = null
let refreshingSince: number | null = null

function respond(body: string, state: CacheState, origin: string | null): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-rt-cache': state,
      ...corsHeaders(origin),
    },
  })
}

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

async function readEdge(cacheKey: Request, now: number): Promise<Memo | null> {
  const cached = await caches.default.match(cacheKey)
  if (!cached) return null
  // Expiry comes from our own header, not Age.
  const expiresAt = Number(cached.headers.get('x-rt-expires'))
  return expiresAt > now ? { body: await cached.text(), expiresAt } : null
}

async function refresh(request: Request, ctx: ExecutionContext): Promise<{ memo: Memo; state: 'edge' | 'miss' }> {
  const cacheKey = new Request(new URL(`/rt?v=${RT_SCHEMA_VERSION}`, request.url))
  const edge = await readEdge(cacheKey, Date.now())
  if (edge) return { memo: edge, state: 'edge' }

  const outcomes = await fetchAllFeeds()
  // Taken after the fetches: Workers' clock only advances on I/O.
  const snapshot = buildSnapshot(outcomes, Math.floor(Date.now() / 1000))
  const fresh: Memo = { body: JSON.stringify(snapshot), expiresAt: Date.now() + TTL_MS }
  ctx.waitUntil(
    caches.default
      .put(
        cacheKey,
        new Response(fresh.body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${TTL_MS / 1000}`,
            'x-rt-expires': String(fresh.expiresAt),
          },
        }),
      )
      .catch(console.error),
  )
  logMiss(request, snapshot, outcomes)
  return { memo: fresh, state: 'miss' }
}

async function serveRealtime(request: Request, ctx: ExecutionContext, origin: string | null): Promise<Response> {
  const now = Date.now()
  const decision = cacheDecision(now, memo, refreshingSince)
  if (decision === 'busy') {
    return new Response('{"error":"warming"}', {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '1', ...corsHeaders(origin) },
    })
  }
  if (decision !== 'refresh' && memo) return respond(memo.body, decision, origin)

  // Claimed synchronously, before any await, so concurrent requests see it.
  refreshingSince = now
  try {
    const result = await refresh(request, ctx)
    // Overlapping refreshes can finish out of order; never move the memo backwards.
    if (!memo || result.memo.expiresAt > memo.expiresAt) memo = result.memo
    return respond(result.memo.body, result.state, origin)
  } catch (e) {
    if (!memo) throw e
    console.error(e)
    return respond(memo.body, 'stale', origin)
  } finally {
    if (refreshingSince === now) refreshingSince = null
  }
}

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    if (new URL(request.url).pathname !== '/rt') return new Response('Not found', { status: 404 })
    const origin = request.headers.get('Origin')
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(origin), ...PREFLIGHT_HEADERS } })
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, OPTIONS' } })
    }
    try {
      return await serveRealtime(request, ctx, origin)
    } catch (e) {
      console.error(e)
      return new Response('{"error":"internal"}', {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
      })
    }
  },
} satisfies ExportedHandler
