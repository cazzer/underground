import { FEED_IDS, RT_SCHEMA_VERSION, type RealtimeSnapshot } from './realtime'

/** Per-request timeout; a hung Worker counts as a failed poll. */
export const FETCH_TIMEOUT_MS = 10_000

/** The Worker speaks a different snapshot version than this build: a reload (new build) fixes it, retrying won't. */
export class SchemaMismatchError extends Error {}

/** Checks the outer shape of a snapshot: version, a numeric `generatedAt`, and every feed. Trips are trusted. */
export function parseSnapshot(raw: unknown): RealtimeSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new Error('realtime response is not an object')
  const r = raw as Record<string, unknown>
  if (r.version !== RT_SCHEMA_VERSION) {
    throw new SchemaMismatchError(`realtime schema v${String(r.version)}, client expects v${RT_SCHEMA_VERSION}; reload`)
  }
  if (typeof r.generatedAt !== 'number' || !Number.isFinite(r.generatedAt)) {
    throw new Error('realtime response has no generatedAt')
  }
  const feeds = r.feeds as Record<string, Record<string, unknown> | undefined> | null | undefined
  for (const id of FEED_IDS) {
    const feed = feeds?.[id]
    if (!feed || typeof feed.stale !== 'boolean' || !Array.isArray(feed.trips)) {
      throw new Error(`realtime response is missing feed "${id}"`)
    }
  }
  return raw as RealtimeSnapshot
}

/** Retry-After as seconds: delta-seconds or an HTTP date. Negative or unparseable gives null. */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (header === null) return null
  const text = header.trim()
  if (/^\d+$/.test(text)) return Number(text)
  const at = Date.parse(text)
  if (Number.isNaN(at)) return null
  const s = (at - nowMs) / 1000
  return s >= 0 ? s : null
}

export type FetchResult =
  | {
      ok: true
      snapshot: RealtimeSnapshot
      /** performance.now() when the headers arrived, before the body was read. */
      receivedPerfMs: number
      /** X-Rt-Cache; null when the browser hides it (not CORS-exposed by the Worker). */
      cache: string | null
    }
  | { ok: false; warming: boolean; schemaMismatch: boolean; error: string; retryAfterS: number | null }

/**
 * One poll. Failures come back as `ok: false` (never thrown) with a message for the HUD and logs;
 * the only throw is the caller's own abort. A 503 with body `{"error":"warming"}` is the Worker
 * filling its cache and is flagged `warming`. Retry-After is read when the browser exposes it.
 */
export async function fetchSnapshot(url: string, signal: AbortSignal): Promise<FetchResult> {
  const fail = (error: string, warming = false, retryAfterS: number | null = null, schemaMismatch = false): FetchResult => ({
    ok: false,
    warming,
    schemaMismatch,
    error,
    retryAfterS,
  })
  try {
    const res = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
      cache: 'no-store',
    })
    const receivedPerfMs = performance.now()
    const retryAfterS = parseRetryAfter(res.headers.get('Retry-After'), Date.now())
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (res.status === 503 && body?.error === 'warming') return fail('HTTP 503 warming', true, retryAfterS)
      return fail(`HTTP ${res.status}`, false, retryAfterS)
    }
    const snapshot = parseSnapshot(await res.json())
    return { ok: true, snapshot, receivedPerfMs, cache: res.headers.get('X-Rt-Cache') }
  } catch (err) {
    if (signal.aborted) throw err
    if (err instanceof DOMException && err.name === 'TimeoutError') return fail(`timeout after ${FETCH_TIMEOUT_MS / 1000} s`)
    return fail(err instanceof Error ? err.message : String(err), false, null, err instanceof SchemaMismatchError)
  }
}
