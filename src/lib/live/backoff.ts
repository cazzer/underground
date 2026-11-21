export const POLL_MS = 20_000
export const BACKOFF_BASE_MS = 2_000
export const BACKOFF_MAX_MS = 60_000
/** Consecutive "warming" responses tolerated before the next one counts as a failure. */
export const WARMING_LIMIT = 3
const WARMING_DEFAULT_S = 1

export type PollOutcome =
  | { kind: 'ok' }
  | { kind: 'warming'; retryAfterS: number | null; warmings: number }
  | { kind: 'error'; retryAfterS: number | null; failures: number }

/** Delay before the next poll. `random` is injected (0..1) so jitter is testable. */
export function nextDelayMs(o: PollOutcome, random: () => number): number {
  switch (o.kind) {
    case 'ok':
      return POLL_MS
    case 'warming':
      return Math.min(Math.max((o.retryAfterS ?? WARMING_DEFAULT_S) * 1000, 1000), BACKOFF_MAX_MS)
    case 'error': {
      const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (o.failures - 1), BACKOFF_MAX_MS)
      return Math.max((o.retryAfterS ?? 0) * 1000, backoff * (0.8 + 0.4 * random()))
    }
  }
}
