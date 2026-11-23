import { useEffect, useMemo, useState } from 'react'
import { ENE_POLICY, ENE_POLL_MS } from '../lib/live/enePoll'
import { devEneCodes, devEneSnapshot } from './eneDevFixture'
import { fetchEne } from './eneFetch'
import type { EneOutage, EneSnapshot } from './realtime'
import { useWorkerPoll, type WorkerPollConfig } from './useWorkerPoll'

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

const ENE_POLL: WorkerPollConfig<EneSnapshot> = { fetch: fetchEne, policy: ENE_POLICY }

/** The `?ene=` fake: a fresh snapshot now and every poll interval. Null outside dev or without the parameter. */
function useDevSnapshot(): EneSnapshot | null {
  const [snapshot, setSnapshot] = useState<EneSnapshot | null>(null)
  useEffect(() => {
    if (!DEV_CODES) return
    const publish = () => setSnapshot(devEneSnapshot(DEV_CODES, Date.now() / 1000))
    publish()
    const timer = window.setInterval(publish, ENE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [])
  return snapshot
}

/**
 * Polls the Worker's /ene (`useWorkerPoll`: every ENE_POLL_MS, backoff, a hidden tab stops, a republish when the
 * snapshot goes stale; decisions are pure, in lib/live/enePoll.ts). Idle when `url` is null; the dev `?ene=` fake
 * replaces the poll.
 */
export function useEne(url: string | null): EneFeed {
  const polled = useWorkerPoll(DEV_CODES ? null : url, ENE_POLL)
  const dev = useDevSnapshot()
  const snapshot = DEV_CODES ? dev : polled.snapshot
  const byCode = useMemo(() => (snapshot ? new Map(snapshot.outages.map((o) => [o.code, o])) : null), [snapshot])
  return useMemo(
    () => ({ configured: url !== null || DEV_CODES !== null, snapshot, byCode, failures: DEV_CODES ? 0 : polled.failures, schemaMismatch: DEV_CODES ? false : polled.schemaMismatch }),
    [url, snapshot, byCode, polled],
  )
}
