import type { WorkerFetchResult } from '../../data/workerFetch'
import { nextDelayMs, WARMING_LIMIT } from './backoff'

/** What one Worker JSON route's poller needs to know about it. */
export interface PollPolicy {
  /** Delay after a good poll. */
  pollMs: number
  /** A snapshot older than this (by the live clock) is too old to show. */
  maxAgeS: number
  /** Names the route in log lines: "Outage" gives "Outage poll failed (2 in a row): …". */
  label: string
}

export interface Timed {
  generatedAt: number
}

/** What a poller remembers between polls. */
export interface WorkerPollState<S extends Timed> {
  /** Latest good snapshot, newest by `generatedAt`. Kept through failures: the join's age check decides when it is too old. */
  snapshot: S | null
  /** Consecutive failed polls. */
  failures: number
  /** Consecutive "warming" responses; kept until a success. */
  warmings: number
  /** The Worker speaks another version of the route; sticky until a poll succeeds. */
  schemaMismatch: boolean
  lastError: string | null
}

export function initialPollState<S extends Timed>(): WorkerPollState<S> {
  return { snapshot: null, failures: 0, warmings: 0, schemaMismatch: false, lastError: null }
}

export interface WorkerPollStep<S extends Timed> {
  next: WorkerPollState<S>
  delayMs: number
  log: { level: 'warn' | 'error'; message: string } | null
  /** Whether the UI state should change (a warming Worker still within its limit is not news). */
  publish: boolean
}

/**
 * Folds one poll result into the poller state and decides the next delay. Pure: the hook logs, publishes and
 * sets the timer. `nowS` is the device clock, used only to log a body that is already too old to show.
 */
export function applyWorkerPoll<S extends Timed>(
  state: WorkerPollState<S>,
  result: WorkerFetchResult<S>,
  random: () => number,
  nowS: number,
  policy: PollPolicy,
): WorkerPollStep<S> {
  if (result.ok) {
    const snapshot = state.snapshot && state.snapshot.generatedAt > result.snapshot.generatedAt ? state.snapshot : result.snapshot
    const ageS = nowS - snapshot.generatedAt
    return {
      next: { snapshot, failures: 0, warmings: 0, schemaMismatch: false, lastError: null },
      delayMs: policy.pollMs,
      log: ageS > policy.maxAgeS ? { level: 'warn', message: `${policy.label} data is ${Math.round(ageS)} s old, not shown` } : null,
      publish: true,
    }
  }
  if (result.warming) {
    const warmings = state.warmings + 1
    if (warmings <= WARMING_LIMIT) {
      return {
        next: { ...state, warmings },
        delayMs: nextDelayMs({ kind: 'warming', retryAfterS: result.retryAfterS, warmings }, random),
        log: { level: 'warn', message: `${policy.label} feed is warming (${warmings}/${WARMING_LIMIT}), retrying` },
        publish: false,
      }
    }
    return failed({ ...state, warmings }, result, random, policy)
  }
  return failed(state, result, random, policy)
}

function failed<S extends Timed>(
  state: WorkerPollState<S>,
  result: Extract<WorkerFetchResult<S>, { ok: false }>,
  random: () => number,
  policy: PollPolicy,
): WorkerPollStep<S> {
  const failures = state.failures + 1
  return {
    next: { ...state, failures, schemaMismatch: state.schemaMismatch || result.schemaMismatch, lastError: result.error },
    delayMs: nextDelayMs({ kind: 'error', retryAfterS: result.retryAfterS, failures }, random),
    log: { level: 'error', message: `${policy.label} poll failed (${failures} in a row): ${result.error}` },
    publish: true,
  }
}
