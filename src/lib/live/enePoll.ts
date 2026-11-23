import type { EneSnapshot } from '../../data/realtime'
import type { EneFetchResult } from '../../data/eneFetch'
import { ENE_MAX_AGE_S } from './eneJoin'
import { applyWorkerPoll, initialPollState, type PollPolicy, type WorkerPollState, type WorkerPollStep } from './workerPoll'

/** Outages change on the order of hours, and the Worker's body is cached for minutes: poll every two. */
export const ENE_POLL_MS = 120_000

export const ENE_POLICY: PollPolicy = { pollMs: ENE_POLL_MS, maxAgeS: ENE_MAX_AGE_S, label: 'Outage' }

/** What the outage poller remembers between polls (eneJoin's age check decides when the snapshot is too old). */
export type EnePollState = WorkerPollState<EneSnapshot>
export type EnePollStep = WorkerPollStep<EneSnapshot>

export const INITIAL_ENE_STATE: EnePollState = initialPollState<EneSnapshot>()

/** Folds one /ene result into the poller state and decides the next delay (`applyWorkerPoll` with the outage policy). */
export function applyEnePoll(state: EnePollState, result: EneFetchResult, random: () => number, nowS: number): EnePollStep {
  return applyWorkerPoll(state, result, random, nowS, ENE_POLICY)
}
