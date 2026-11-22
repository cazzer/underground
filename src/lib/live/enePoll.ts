import type { EneSnapshot } from '../../data/realtime'
import type { EneFetchResult } from '../../data/eneFetch'
import { nextDelayMs, WARMING_LIMIT } from './backoff'
import { ENE_MAX_AGE_S } from './eneJoin'

/** Outages change on the order of hours, and the Worker's body is cached for minutes: poll every two. */
export const ENE_POLL_MS = 120_000

/** What the outage poller remembers between polls. */
export interface EnePollState {
  /** Latest good snapshot, newest by `generatedAt`. Kept through failures: eneJoin's age check decides when it is too old. */
  snapshot: EneSnapshot | null
  /** Consecutive failed polls. */
  failures: number
  /** Consecutive "warming" responses; kept until a success. */
  warmings: number
  /** The Worker speaks another /ene version; sticky until a poll succeeds. */
  schemaMismatch: boolean
  lastError: string | null
}

export const INITIAL_ENE_STATE: EnePollState = { snapshot: null, failures: 0, warmings: 0, schemaMismatch: false, lastError: null }

export interface EnePollStep {
  next: EnePollState
  delayMs: number
  log: { level: 'warn' | 'error'; message: string } | null
  /** Whether the UI state should change (a warming Worker still within its limit is not news). */
  publish: boolean
}

/**
 * Folds one /ene result into the poller state and decides the next delay. Pure: the hook logs, publishes and
 * sets the timer. `nowS` is the device clock, used only to log a body that is already too old to show.
 */
export function applyEnePoll(state: EnePollState, result: EneFetchResult, random: () => number, nowS: number): EnePollStep {
  if (result.ok) {
    const snapshot = state.snapshot && state.snapshot.generatedAt > result.snapshot.generatedAt ? state.snapshot : result.snapshot
    const ageS = nowS - snapshot.generatedAt
    return {
      next: { snapshot, failures: 0, warmings: 0, schemaMismatch: false, lastError: null },
      delayMs: ENE_POLL_MS,
      log: ageS > ENE_MAX_AGE_S ? { level: 'warn', message: `Outage data is ${Math.round(ageS)} s old, not shown` } : null,
      publish: true,
    }
  }
  if (result.warming) {
    const warmings = state.warmings + 1
    if (warmings <= WARMING_LIMIT) {
      return {
        next: { ...state, warmings },
        delayMs: nextDelayMs({ kind: 'warming', retryAfterS: result.retryAfterS, warmings }, random),
        log: { level: 'warn', message: `Outage feed is warming (${warmings}/${WARMING_LIMIT}), retrying` },
        publish: false,
      }
    }
    return failed({ ...state, warmings }, result, random)
  }
  return failed(state, result, random)
}

function failed(state: EnePollState, result: Extract<EneFetchResult, { ok: false }>, random: () => number): EnePollStep {
  const failures = state.failures + 1
  return {
    next: { ...state, failures, schemaMismatch: state.schemaMismatch || result.schemaMismatch, lastError: result.error },
    delayMs: nextDelayMs({ kind: 'error', retryAfterS: result.retryAfterS, failures }, random),
    log: { level: 'error', message: `Outage poll failed (${failures} in a row): ${result.error}` },
    publish: true,
  }
}
