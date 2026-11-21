import { useEffect, useState } from 'react'
import { applyPollResult, INITIAL_POLL_STATE, resultFromThrown, type PollState } from '../lib/live/pollOutcome'
import type { RealtimeSnapshot } from './realtime'
import { fetchSnapshot, type FetchResult } from './realtimeFetch'

export interface RealtimeFeed {
  /** Latest good snapshot; null before the first, and after an outage outlasts SNAPSHOT_MAX_AGE_S. */
  snapshot: RealtimeSnapshot | null
  /** Live-clock offset (see clock.ts); null until the first snapshot. */
  offsetS: number | null
  /** Consecutive failed polls ("warming" responses don't count until they persist). */
  failures: number
  lastError: string | null
  /** The Worker's snapshot version isn't this build's: only a reload helps. */
  schemaMismatch: boolean
  /** X-Rt-Cache of the latest response, when the browser exposes it. */
  cache: string | null
}

const publicView = (s: PollState): RealtimeFeed => ({
  snapshot: s.snapshot,
  offsetS: s.offsetS,
  failures: s.failures,
  lastError: s.lastError,
  schemaMismatch: s.schemaMismatch,
  cache: s.cache,
})

/**
 * Polls the Worker one request at a time: every POLL_MS when healthy, with jittered backoff on
 * failure (the decisions are pure, in lib/live/pollOutcome.ts). A hidden tab stops polling (the in-flight
 * request is aborted); becoming visible polls at once. Every failure is logged. Idle when `url` is null.
 */
export function useRealtimeFeed(url: string | null): RealtimeFeed {
  const [feed, setFeed] = useState<RealtimeFeed>(() => publicView(INITIAL_POLL_STATE))

  useEffect(() => {
    if (!url) return
    let state = INITIAL_POLL_STATE
    let timer: number | undefined
    let controller: AbortController | null = null

    const schedule = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(poll, ms)
    }

    async function poll(): Promise<void> {
      controller?.abort()
      const own = (controller = new AbortController())
      let result: FetchResult
      try {
        result = await fetchSnapshot(url!, own.signal)
      } catch (err) {
        // fetchSnapshot only throws for our own abort (hidden tab, unmount, a newer poll); anything else is a failure.
        if (own.signal.aborted) return
        result = resultFromThrown(err)
      }
      if (own.signal.aborted) return

      const step = applyPollResult(state, result, {
        perfNowMs: result.ok ? result.receivedPerfMs : performance.now(),
        wallNowS: Date.now() / 1000,
        random: Math.random,
      })
      state = step.next
      if (step.log) console[step.log.level](step.log.message, url)
      if (step.publish) setFeed(publicView(state))
      schedule(step.delayMs)
    }

    const onVisibility = () => {
      if (document.hidden) {
        controller?.abort()
        window.clearTimeout(timer)
      } else {
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) void poll()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      controller?.abort()
      window.clearTimeout(timer)
    }
  }, [url])

  return feed
}
