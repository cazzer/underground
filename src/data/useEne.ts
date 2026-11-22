import { useEffect, useState } from 'react'
import { ENE_MAX_AGE_S } from '../lib/live/eneJoin'
import { applyEnePoll, ENE_POLL_MS, INITIAL_ENE_STATE, type EnePollState } from '../lib/live/enePoll'
import { devEneCodes, devEneSnapshot } from './eneDevFixture'
import { fetchEne, type EneFetchResult } from './eneFetch'
import type { EneOutage, EneSnapshot } from './realtime'

export interface EneFeed {
  /** True when outages are being polled (or faked by `?ene=` in dev); false means nothing here is news. */
  configured: boolean
  /** Latest good snapshot, however old; eneJoin decides whether it is fresh enough to show. */
  snapshot: EneSnapshot | null
  /** `snapshot`'s outages by equipment code; null with no snapshot. */
  byCode: ReadonlyMap<string, EneOutage> | null
  /** Consecutive failed polls. */
  failures: number
  /** The Worker's /ene version isn't this build's: only a reload helps. */
  schemaMismatch: boolean
}

/** Dev only: `?ene=EL358,EL359` fakes a snapshot with those machines out, with or without a Worker. */
const DEV_CODES = import.meta.env.DEV ? devEneCodes(window.location.search) : null

/**
 * The republish that flips a snapshot to stale comes this long after `generatedAt + ENE_MAX_AGE_S` by the device clock:
 * the join measures age on the /rt live clock, which can run a poll's worth (about 15 s) behind it.
 */
const EXPIRY_SLACK_S = 20

const index = (snapshot: EneSnapshot | null): EneFeed['byCode'] => snapshot && new Map(snapshot.outages.map((o) => [o.code, o]))

/**
 * Polls the Worker's /ene one request at a time: every ENE_POLL_MS when healthy, with jittered backoff on failure
 * (decisions are pure, in lib/live/enePoll.ts). A hidden tab stops polling, aborting the request in flight;
 * becoming visible polls at once unless one finished within the last ENE_POLL_MS. Each such return also publishes a
 * fresh object, so the panel re-checks the snapshot's age. Every failure is logged. Idle when `url` is null.
 */
export function useEne(url: string | null): EneFeed {
  const [feed, setFeed] = useState<EneFeed>({ configured: url !== null || DEV_CODES !== null, snapshot: null, byCode: null, failures: 0, schemaMismatch: false })

  useEffect(() => {
    if (DEV_CODES) {
      const publish = () => {
        const snapshot = devEneSnapshot(DEV_CODES, Date.now() / 1000)
        setFeed({ configured: true, snapshot, byCode: index(snapshot), failures: 0, schemaMismatch: false })
      }
      publish()
      const timer = window.setInterval(publish, ENE_POLL_MS)
      return () => window.clearInterval(timer)
    }
    if (!url) return
    let state: EnePollState = INITIAL_ENE_STATE
    let timer: number | undefined
    let controller: AbortController | null = null
    /** When the last poll finished (an aborted one never does), for the return from a hidden tab. */
    let lastDoneMs = -Infinity
    let byCode = index(state.snapshot)
    let byCodeOf: EneSnapshot | null = state.snapshot
    let expiry: number | undefined

    const publish = () => {
      if (state.snapshot !== byCodeOf) {
        byCodeOf = state.snapshot
        byCode = index(byCodeOf)
      }
      setFeed({ configured: true, snapshot: state.snapshot, byCode, failures: state.failures, schemaMismatch: state.schemaMismatch })
      // The panel reads the age at render time, and nothing else may render when the data goes stale: republish then.
      window.clearTimeout(expiry)
      if (state.snapshot === null) return
      const inMs = (state.snapshot.generatedAt + ENE_MAX_AGE_S + EXPIRY_SLACK_S - Date.now() / 1000) * 1000
      if (inMs > 0) expiry = window.setTimeout(publish, inMs)
    }
    const schedule = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(poll, ms)
    }

    async function poll(): Promise<void> {
      controller?.abort()
      const own = (controller = new AbortController())
      let result: EneFetchResult
      try {
        result = await fetchEne(url!, own.signal)
      } catch (err) {
        // fetchEne only throws for our own abort (hidden tab, unmount, a newer poll); anything else is a failure.
        if (own.signal.aborted) return
        result = { ok: false, warming: false, schemaMismatch: false, error: err instanceof Error ? err.message : String(err), retryAfterS: null }
      }
      if (own.signal.aborted) return
      lastDoneMs = performance.now()
      const step = applyEnePoll(state, result, Math.random, Date.now() / 1000)
      state = step.next
      if (step.log) console[step.log.level](step.log.message, url)
      if (step.publish) publish()
      schedule(step.delayMs)
    }

    const resume = () => {
      publish()
      const sinceMs = performance.now() - lastDoneMs
      if (sinceMs >= ENE_POLL_MS) void poll()
      else schedule(ENE_POLL_MS - sinceMs)
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
  }, [url])

  return feed
}
