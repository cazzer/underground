import { useMemo } from 'react'
import { ALERTS_MAX_AGE_S, type AlertsInput } from '../lib/live/alertJoin'
import type { PollPolicy } from '../lib/live/workerPoll'
import { fetchAlerts } from './alertsFetch'
import type { AlertsSnapshot } from './realtime'
import { useWorkerPoll, type WorkerPollConfig } from './useWorkerPoll'

/** Service changes move on the order of minutes to hours, and the Worker's body is cached for two: poll every two. */
export const ALERTS_POLL_MS = 120_000

const ALERTS_POLICY: PollPolicy = { pollMs: ALERTS_POLL_MS, maxAgeS: ALERTS_MAX_AGE_S, label: 'Alerts' }
const ALERTS_POLL: WorkerPollConfig<AlertsSnapshot> = { fetch: fetchAlerts, policy: ALERTS_POLICY }

/**
 * Polls the Worker's /alerts (`useWorkerPoll`: one request at a time, a hidden tab stops, a republish when the
 * snapshot goes stale). Idle, and `configured` false, when `url` is null: nothing is fetched and the panel says nothing.
 */
export function useAlerts(url: string | null): AlertsInput {
  const polled = useWorkerPoll(url, ALERTS_POLL)
  return useMemo(() => ({ configured: url !== null, ...polled }), [url, polled])
}
