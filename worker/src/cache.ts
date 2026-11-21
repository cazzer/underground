export const TTL_MS = 15_000
/** A refresh older than this is presumed dead (upstream fetches time out at 5 s). */
export const REFRESH_GRACE_MS = 6_000

export interface Memo {
  body: string
  expiresAt: number
}

export type CacheDecision = 'memory' | 'stale' | 'refresh'

/**
 * Per-isolate herd guard, no shared promises:
 * - fresh body: serve it ('memory')
 * - expired body while a recent refresh is in flight: serve the old body ('stale')
 * - otherwise: this request refreshes ('refresh')
 *
 * Bound: with no body at all (cold isolate) every concurrent request refreshes, so a
 * burst of N requests hitting a cold isolate causes up to N upstream rounds. Once the
 * first refresh lands, the rest of that isolate's traffic is served from the memo.
 */
export function cacheDecision(now: number, memo: Memo | null, refreshingSince: number | null): CacheDecision {
  if (memo && now < memo.expiresAt) return 'memory'
  if (memo && refreshingSince !== null && now - refreshingSince < REFRESH_GRACE_MS) return 'stale'
  return 'refresh'
}
