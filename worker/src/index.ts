import { PREFLIGHT_HEADERS, corsHeaders } from './cors'
import { RT_SCHEMA_VERSION, FEED_IDS } from './schema'
import { buildSnapshot } from './transform'
import { fetchAllFeeds } from './upstream'

const TTL_S = 15
type CacheState = 'memory' | 'edge' | 'miss'

// Holds resolved strings only: Workers can hang on promises shared across requests.
let memo: { body: string; expiresAt: number } | null = null

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

async function serveRealtime(request: Request, ctx: ExecutionContext, origin: string | null): Promise<Response> {
  const now = Date.now()
  if (memo && now < memo.expiresAt) return respond(memo.body, 'memory', origin)

  const cacheKey = new Request(new URL(`/rt?v=${RT_SCHEMA_VERSION}`, request.url))
  const cached = await caches.default.match(cacheKey)
  if (cached) {
    const body = await cached.text()
    const ageMs = (Number(cached.headers.get('age')) || 0) * 1000
    memo = { body, expiresAt: now + Math.max(0, TTL_S * 1000 - ageMs) }
    return respond(body, 'edge', origin)
  }

  const outcomes = await fetchAllFeeds()
  // Taken after the fetches: Workers' clock only advances on I/O.
  const snapshot = buildSnapshot(outcomes, Math.floor(Date.now() / 1000))
  const body = JSON.stringify(snapshot)
  memo = { body, expiresAt: Date.now() + TTL_S * 1000 }
  ctx.waitUntil(
    caches.default
      .put(
        cacheKey,
        new Response(body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${TTL_S}`,
          },
        }),
      )
      .catch(console.error),
  )
  // Read by Workers Logs to check "at most one upstream fetch per 15 s per colo".
  console.log(
    JSON.stringify({
      event: 'rt-miss',
      colo: request.cf?.colo,
      errors: FEED_IDS.flatMap((id) => {
        const error = snapshot.feeds[id].error
        return error === null ? [] : [{ feed: id, error }]
      }),
      dropped: FEED_IDS.reduce((sum, id) => sum + snapshot.feeds[id].droppedEntities, 0),
    }),
  )
  return respond(body, 'miss', origin)
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
