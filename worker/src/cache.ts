/** Memo and edge lifetimes per route: /rt and /ene; /geocode per key (its own LRU and edge entries). */
export const RT_TTL_MS = 15_000
export const ENE_TTL_MS = 120_000
export const GEOCODE_TTL_MS = 3_600_000
/** After a /geocode source fails, its calls are skipped this long (the answer is then incomplete). */
export const GEOCODE_SOURCE_BACKOFF_MS = 30_000
/** A refresh older than this is presumed dead (upstream fetches time out at 5 s). */
export const REFRESH_GRACE_MS = 6_000
/** After a failed refresh, serve the old body (or 503) this long before trying upstream again. */
export const FAILURE_BACKOFF_MS = 15_000

export interface Memo {
  body: string
  expiresAt: number
}

export type CacheDecision = 'memory' | 'stale' | 'busy' | 'refresh'

/**
 * Per-isolate herd guard, no shared promises:
 * - fresh body: serve it ('memory')
 * - expired body while a recent refresh is in flight: serve the old body ('stale')
 * - no body at all while a recent refresh is in flight: ask the caller to retry ('busy')
 * - otherwise: this request refreshes ('refresh')
 *
 * Bound: at most one refresh is in flight per isolate (a claim older than the grace
 * period is presumed dead and may be taken over).
 *
 * Freshness, worst case per route: /rt about 36 s = 15 s upstream cf cache + 15 s memo + 6 s grace;
 * /ene about 246 s = 120 s upstream cf cache + 120 s memo + 6 s grace. After a failed refresh the
 * stale body can be served up to FAILURE_BACKOFF_MS (15 s) longer per failed attempt.
 */
export function cacheDecision(now: number, memo: Memo | null, refreshingSince: number | null): CacheDecision {
  if (memo && now < memo.expiresAt) return 'memory'
  if (refreshingSince !== null && now - refreshingSince < REFRESH_GRACE_MS) return memo ? 'stale' : 'busy'
  return 'refresh'
}
