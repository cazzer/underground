import { useEffect, useState } from 'react'
import type { RealtimeSnapshot } from './realtime'
import { fetchSnapshot } from './realtimeFetch'
import { nextDelayMs, WARMING_LIMIT } from '../lib/live/backoff'
import { clockNow, SNAPSHOT_MAX_AGE_S, updateClockOffset } from '../lib/live/clock'

export interface RealtimeFeed {
  /** Latest good snapshot; null before the first, and after an outage outlasts SNAPSHOT_MAX_AGE_S. */
  snapshot: RealtimeSnapshot | null
  /** Live-clock offset (see clock.ts); null until the first snapshot. */
  offsetS: number | null
  /** Consecutive failed polls ("warming" responses don't count until they persist). */
  failures: number
  lastError: string | null
  /** X-Rt-Cache of the latest response, when the browser exposes it. */
  cache: string | null
}

const IDLE: RealtimeFeed = { snapshot: null, offsetS: null, failures: 0, lastError: null, cache: null }

/**
 * Polls the Worker one request at a time: every POLL_MS when healthy, with jittered backoff on
 * failure. A hidden tab stops polling (the in-flight request is aborted); becoming visible polls
 * at once. Every failure is logged. Idle when `url` is null.
 */
export function useRealtimeFeed(url: string | null): RealtimeFeed {
  const [feed, setFeed] = useState<RealtimeFeed>(IDLE)

  useEffect(() => {
    if (!url) return
    let offsetS: number | null = null
    let snapshot: RealtimeSnapshot | null = null
    let failures = 0
    let warmings = 0
    let timer: number | undefined
    let controller: AbortController | null = null

    const schedule = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(poll, ms)
    }

    async function poll(): Promise<void> {
      controller?.abort()
      const own = (controller = new AbortController())
      let result
      try {
        result = await fetchSnapshot(url!, own.signal)
      } catch (err) {
        // Only our own abort (hidden tab, unmount, a newer poll) throws.
        if (own.signal.aborted) return
        throw err
      }
      if (own.signal.aborted) return

      if (result.ok) {
        failures = 0
        warmings = 0
        snapshot = result.snapshot
        offsetS = updateClockOffset(offsetS, snapshot.generatedAt, result.receivedPerfMs)
        setFeed({ snapshot, offsetS, failures, lastError: null, cache: result.cache })
        schedule(nextDelayMs({ kind: 'ok' }, Math.random))
        return
      }

      if (result.warming && ++warmings <= WARMING_LIMIT) {
        console.warn(`Realtime Worker is warming (${warmings}/${WARMING_LIMIT}), retrying`, url)
        schedule(nextDelayMs({ kind: 'warming', retryAfterS: result.retryAfterS, warmings }, Math.random))
        return
      }
      warmings = 0
      failures++
      console.error(`Realtime poll failed (${failures} in a row): ${result.error}`, url)
      if (snapshot && offsetS !== null && clockNow(offsetS, performance.now()) - snapshot.generatedAt > SNAPSHOT_MAX_AGE_S) {
        snapshot = null
      }
      setFeed((prev) => ({ ...prev, snapshot, failures, lastError: result.error }))
      schedule(nextDelayMs({ kind: 'error', retryAfterS: result.retryAfterS, failures }, Math.random))
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
