import { useEffect, useState } from 'react'
import { initialPollState, applyWorkerPoll, type PollPolicy, type Timed, type WorkerPollState } from '../lib/live/workerPoll'
import type { WorkerFetchResult } from './workerFetch'

/** What a poll hook publishes; each publish is a new object, so a consumer re-checks the snapshot's age. */
export interface Polled<S> {
  /** Latest good snapshot, however old; the route's join decides whether it is fresh enough to show. */
  snapshot: S | null
  /** Consecutive failed polls. */
  failures: number
  /** The Worker's version of the route isn't this build's: only a reload helps. */
  schemaMismatch: boolean
}

/** One Worker JSON route: its fetch (which parses and checks the body) and its timing and log words. */
export interface WorkerPollConfig<S> {
  fetch: (url: string, signal: AbortSignal) => Promise<WorkerFetchResult<S>>
  policy: PollPolicy
}

/**
 * The republish that flips a snapshot to stale comes this long after `generatedAt + maxAgeS` by the device clock:
 * the join measures age on the /rt live clock, which can run a poll's worth (about 15 s) behind it.
 */
const EXPIRY_SLACK_S = 20

const EMPTY: Polled<never> = { snapshot: null, failures: 0, schemaMismatch: false }

/**
 * Polls a Worker JSON route one request at a time: every `policy.pollMs` when healthy, with jittered backoff on
 * failure (decisions are pure, in lib/live/workerPoll.ts). A hidden tab stops polling, aborting the request in
 * flight; becoming visible polls at once unless one finished within the last `pollMs`. Each such return also
 * publishes a fresh object, so the panel re-checks the snapshot's age. Every failure is logged. Idle when `url` is
 * null. `config` must be a stable object (a module constant).
 */
export function useWorkerPoll<S extends Timed>(url: string | null, config: WorkerPollConfig<S>): Polled<S> {
  const [feed, setFeed] = useState<Polled<S>>(EMPTY)

  useEffect(() => {
    if (!url) return
    const { policy } = config
    let state: WorkerPollState<S> = initialPollState<S>()
    let timer: number | undefined
    let controller: AbortController | null = null
    /** When the last poll finished (an aborted one never does), for the return from a hidden tab. */
    let lastDoneMs = -Infinity
    let expiry: number | undefined

    const publish = () => {
      setFeed({ snapshot: state.snapshot, failures: state.failures, schemaMismatch: state.schemaMismatch })
      // The panel reads the age at render time, and nothing else may render when the data goes stale: republish then.
      window.clearTimeout(expiry)
      if (state.snapshot === null) return
      const inMs = (state.snapshot.generatedAt + policy.maxAgeS + EXPIRY_SLACK_S - Date.now() / 1000) * 1000
      if (inMs > 0) expiry = window.setTimeout(publish, inMs)
    }
    const schedule = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(poll, ms)
    }

    async function poll(): Promise<void> {
      controller?.abort()
      const own = (controller = new AbortController())
      let result: WorkerFetchResult<S>
      try {
        result = await config.fetch(url!, own.signal)
      } catch (err) {
        // The fetch only throws for our own abort (hidden tab, unmount, a newer poll); anything else is a failure.
        if (own.signal.aborted) return
        result = { ok: false, warming: false, schemaMismatch: false, error: err instanceof Error ? err.message : String(err), retryAfterS: null }
      }
      if (own.signal.aborted) return
      lastDoneMs = performance.now()
      const step = applyWorkerPoll(state, result, Math.random, Date.now() / 1000, policy)
      state = step.next
      if (step.log) console[step.log.level](step.log.message, url)
      if (step.publish) publish()
      schedule(step.delayMs)
    }

    const resume = () => {
      publish()
      const sinceMs = performance.now() - lastDoneMs
      if (sinceMs >= policy.pollMs) void poll()
      else schedule(policy.pollMs - sinceMs)
    }
    const onVisibility = () => {
      if (document.hidden) {
        controller?.abort()
        window.clearTimeout(timer)
        window.clearTimeout(expiry)
      } else {
        resume()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) void poll()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      controller?.abort()
      window.clearTimeout(timer)
      window.clearTimeout(expiry)
    }
  }, [url, config])

  return feed
}
