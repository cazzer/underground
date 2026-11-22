import { CLIENT_PERIOD_S, clientAllowed, createClientLimitWarned, type ClientLimitWarned } from './clientLimit'
import { GEOCODE_SOURCE_BACKOFF_MS, GEOCODE_TTL_MS, type Memo } from './cache'
import { corsHeaders, isAllowedOrigin } from './cors'
import { readEdge, writeEdge, type EdgeCache } from './edgeCache'
import { geocodeAnswer, logLine, shouldBackOff, type SourceOutcome } from './geocodeOutcome'
import { hasSatisfyingHit } from './geocodeMerge'
import { cacheKeyPath, looksLikeBusiness, parseGeocodeRequest, type GeocodeQuery } from './geocodeQuery'
import { TtlLru } from './lru'
import { createBucket, msUntilToken, tryTake, type TokenBucket } from './rateLimit'
import type { GeocodeErrorCode, GeocodeSource } from './schema'

const LRU_ENTRIES = 500
/** All upstream calls (per isolate): a burst of 20, then 2 a second. GeoSearch publishes no limit. */
const UPSTREAM_BUCKET: [number, number] = [20, 2]
/** Photon on top: it asks for a "reasonable limit". */
const PHOTON_BUCKET: [number, number] = [5, 0.5]

export interface GeocodeState {
  lru: TtlLru
  upstream: TokenBucket
  photon: TokenBucket
  failedUntil: Record<GeocodeSource, number | null>
  clientLimitWarned: ClientLimitWarned
}

export function createGeocodeState(now: number): GeocodeState {
  return {
    lru: new TtlLru(LRU_ENTRIES),
    upstream: createBucket(...UPSTREAM_BUCKET, now),
    photon: createBucket(...PHOTON_BUCKET, now),
    failedUntil: { geosearch: null, photon: null },
    clientLimitWarned: createClientLimitWarned(),
  }
}

export interface GeocodeDeps {
  fetchGeoSearch(q: GeocodeQuery): Promise<SourceOutcome>
  fetchPhoton(q: GeocodeQuery): Promise<SourceOutcome>
  state: GeocodeState
  /** The Workers Rate Limiting binding (`env.GEOCODE_CLIENT_LIMIT`); absent means no per-client limit (`clientAllowed`). */
  clientLimit?: RateLimit
}

type Ctx = { waitUntil(p: Promise<unknown>): void }

const JSON_TYPE = 'application/json; charset=utf-8'

function failure(status: number, error: GeocodeErrorCode, origin: string | null, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...extra, ...corsHeaders(origin) },
  })
}

/**
 * Never cached by the browser: the one-hour cache stays on the server, so no typed query lands in a device's disk
 * cache. No `x-rt-cache` either: it would tell one user whether another had just searched the same text.
 */
function answer(body: string, origin: string | null): Response {
  return new Response(body, {
    headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...corsHeaders(origin) },
  })
}

/** Whether `source` may be called now; takes its tokens if so. Taken before any await, so concurrent calls see them. */
function gate(source: GeocodeSource, state: GeocodeState, now: number): 'go' | 'limited' | 'backoff' {
  const until = state.failedUntil[source]
  if (until !== null && until > now) return 'backoff'
  return tryTake(source === 'photon' ? [state.upstream, state.photon] : [state.upstream], now) ? 'go' : 'limited'
}

async function callSource(source: GeocodeSource, q: GeocodeQuery, deps: GeocodeDeps): Promise<SourceOutcome> {
  const { state } = deps
  const verdict = gate(source, state, Date.now())
  if (verdict !== 'go') return { status: verdict }
  let outcome: SourceOutcome
  try {
    outcome = await (source === 'photon' ? deps.fetchPhoton(q) : deps.fetchGeoSearch(q))
  } catch {
    // Fetchers never reject; if one does, its message may hold the query, so only a fixed code is kept.
    outcome = { status: 'failed', error: 'fetch-failed' }
  }
  if (outcome.status === 'failed') {
    // Only a sign the source is struggling backs it off; a failure a query can cause does not.
    if (shouldBackOff(outcome.error)) state.failedUntil[source] = Date.now() + GEOCODE_SOURCE_BACKOFF_MS
    console.error(JSON.stringify({ event: 'geocode-upstream-error', source, error: outcome.error }))
  } else {
    state.failedUntil[source] = null
  }
  return outcome
}

/** An edge read that fails is a miss: the answer can still come from upstream. Only a fixed code is logged. */
async function readEdgeOrNull(edge: EdgeCache, key: Request): Promise<Memo | null> {
  try {
    return await readEdge(edge, key, Date.now())
  } catch {
    console.error('{"event":"geocode-edge-read-failed"}')
    return null
  }
}

/** Business names are OSM's: ask both at once. Otherwise GeoSearch, and Photon only if it had no hit of the kind asked for. */
async function gather(q: GeocodeQuery, deps: GeocodeDeps): Promise<{ outcomes: Record<GeocodeSource, SourceOutcome>; photonFirst: boolean }> {
  if (looksLikeBusiness(q.text)) {
    const [geosearch, photon] = await Promise.all([callSource('geosearch', q, deps), callSource('photon', q, deps)])
    return { outcomes: { geosearch, photon }, photonFirst: true }
  }
  const geosearch = await callSource('geosearch', q, deps)
  const satisfied = geosearch.status === 'ok' && hasSatisfyingHit(geosearch.results.candidates, q.text)
  const photon: SourceOutcome = satisfied ? { status: 'unneeded' } : await callSource('photon', q, deps)
  return { outcomes: { geosearch, photon }, photonFirst: false }
}

/** Seconds until a skipped source could be called, the soonest of them; at least 1. */
function retryAfterS(outcomes: Record<GeocodeSource, SourceOutcome>, state: GeocodeState): number {
  const now = Date.now()
  const waits = (['geosearch', 'photon'] as const).flatMap((s) => {
    const status = outcomes[s].status
    if (status === 'backoff') return [(state.failedUntil[s] ?? now) - now]
    if (status === 'limited') return [msUntilToken(s === 'photon' ? [state.upstream, state.photon] : [state.upstream], now)]
    return []
  })
  return Math.max(1, Math.ceil(Math.min(...waits) / 1000))
}

interface Miss {
  request: Request
  ctx: Ctx
  origin: string | null
  edge: EdgeCache
  deps: GeocodeDeps
  query: GeocodeQuery
  lruKey: string
  edgeKey: Request
}

async function serveMiss(m: Miss): Promise<Response> {
  const { outcomes, photonFirst } = await gather(m.query, m.deps)
  const result = geocodeAnswer(m.query, outcomes, photonFirst)
  const colo = m.request.cf?.colo
  console.log(logLine(typeof colo === 'string' ? colo : undefined, outcomes, result.status === 200 ? result.results : 0))
  if (result.status === 503) {
    return failure(503, 'busy', m.origin, {
      'retry-after': String(retryAfterS(outcomes, m.deps.state)),
      // So the client can read it cross-origin (2q7.16 backs off by it).
      'access-control-expose-headers': 'retry-after',
    })
  }
  if (result.status === 502) return failure(502, 'upstream', m.origin)
  if (result.cacheable) {
    // Taken after the fetches: Workers' clock only advances on I/O.
    const memo: Memo = { body: result.body, expiresAt: Date.now() + GEOCODE_TTL_MS }
    m.deps.state.lru.set(m.lruKey, memo)
    writeEdge(m.edge, m.ctx, m.edgeKey, memo, GEOCODE_TTL_MS, () => console.error('{"event":"geocode-edge-put-failed"}'))
  }
  return answer(result.body, m.origin)
}

/**
 * GET /geocode: the Origin check, the per-client limit (429), a per-isolate LRU, then the edge cache, then the sources (see `gather`). Never throws. No log
 * line, error or header ever carries the query or the focus.
 */
export async function serveGeocode(request: Request, ctx: Ctx, origin: string | null, edge: EdgeCache, deps: GeocodeDeps): Promise<Response> {
  try {
    // A foreign site (or no site at all) stays off the Photon budget.
    if (!isAllowedOrigin(origin)) return failure(403, 'forbidden', origin)
    // Before parsing and both caches, so a client can't probe what is cached (or what parses) at any rate.
    if (!(await clientAllowed(deps.clientLimit, request, deps.state.clientLimitWarned))) {
      return failure(429, 'rate-limited', origin, {
        'retry-after': String(CLIENT_PERIOD_S),
        'access-control-expose-headers': 'retry-after',
      })
    }
    const parsed = parseGeocodeRequest(new URL(request.url))
    if (!parsed.ok) return failure(400, parsed.error, origin)
    const { query } = parsed
    const lruKey = cacheKeyPath(query)
    const edgeKey = new Request(new URL(lruKey, request.url))

    const hot = deps.state.lru.get(lruKey, Date.now())
    if (hot) return answer(hot.body, origin)
    const warm = await readEdgeOrNull(edge, edgeKey)
    if (warm) {
      deps.state.lru.set(lruKey, warm)
      return answer(warm.body, origin)
    }
    return await serveMiss({ request, ctx, origin, edge, deps, query, lruKey, edgeKey })
  } catch (e) {
    console.error(JSON.stringify({ event: 'geocode-internal', name: e instanceof Error ? e.name : typeof e }))
    return failure(500, 'internal', origin)
  }
}
