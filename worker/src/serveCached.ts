import { FAILURE_BACKOFF_MS, cacheDecision, type CacheDecision, type Memo } from './cache'
import { corsHeaders } from './cors'
import { readEdge, writeEdge, type EdgeCache } from './edgeCache'

export type { EdgeCache }

type CacheState = Exclude<CacheDecision, 'busy' | 'refresh'> | 'edge' | 'miss'

export interface CachedRoute {
  /** Path and query of the edge cache key, e.g. `/rt?v=1`. */
  cachePath: string
  ttlMs: number
  /** Fetches upstream and returns the JSON body; a throw serves the stale memo, else a 500. */
  build(request: Request): Promise<string>
  /**
   * The route's per-isolate state. Resolved values only: Workers can hang on promises
   * shared across requests.
   */
  state: { memo: Memo | null; refreshingSince: number | null; failedUntil: number | null }
}

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

async function refresh(
  route: CachedRoute,
  request: Request,
  ctx: { waitUntil(p: Promise<unknown>): void },
  edge: EdgeCache,
): Promise<{ memo: Memo; state: 'edge' | 'miss' }> {
  const cacheKey = new Request(new URL(route.cachePath, request.url))
  const cached = await readEdge(edge, cacheKey, Date.now())
  if (cached) return { memo: cached, state: 'edge' }

  const body = await route.build(request)
  // Taken after the fetches: Workers' clock only advances on I/O.
  const fresh: Memo = { body, expiresAt: Date.now() + route.ttlMs }
  writeEdge(edge, ctx, cacheKey, fresh, route.ttlMs)
  return { memo: fresh, state: 'miss' }
}

/** Serves one route from its memo, then the edge cache, then `route.build`; see `cacheDecision` for the herd guard. */
export async function serveCached(
  route: CachedRoute,
  request: Request,
  ctx: { waitUntil(p: Promise<unknown>): void },
  origin: string | null,
  edge: EdgeCache,
): Promise<Response> {
  const { state } = route
  const now = Date.now()
  let decision = cacheDecision(now, state.memo, state.refreshingSince)
  // After a failed refresh, don't hit a struggling upstream on every request.
  const backoffLeftMs = state.failedUntil === null ? 0 : state.failedUntil - now
  const backedOff = decision === 'refresh' && backoffLeftMs > 0
  if (backedOff) decision = state.memo ? 'stale' : 'busy'
  if (decision === 'busy') {
    // Warming resolves in about a second; a failed upstream says how long the backoff has left.
    return new Response(backedOff ? '{"error":"upstream"}' : '{"error":"warming"}', {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': backedOff ? String(Math.max(1, Math.ceil(backoffLeftMs / 1000))) : '1',
        ...corsHeaders(origin),
      },
    })
  }
  if (decision !== 'refresh' && state.memo) return respond(state.memo.body, decision, origin)

  // Claimed synchronously, before any await, so concurrent requests see it.
  state.refreshingSince = now
  try {
    const result = await refresh(route, request, ctx, edge)
    // Overlapping refreshes can finish out of order; never move the memo backwards.
    if (!state.memo || result.memo.expiresAt > state.memo.expiresAt) state.memo = result.memo
    // Only the current claim records the outcome; a taken-over refresh must not undo it.
    if (state.refreshingSince === now) state.failedUntil = null
    return respond(result.memo.body, result.state, origin)
  } catch (e) {
    if (state.refreshingSince === now) state.failedUntil = Date.now() + FAILURE_BACKOFF_MS
    if (!state.memo) throw e
    console.error(e)
    return respond(state.memo.body, 'stale', origin)
  } finally {
    if (state.refreshingSince === now) state.refreshingSince = null
  }
}
