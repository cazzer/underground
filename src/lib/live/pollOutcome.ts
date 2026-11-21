import type { RealtimeSnapshot } from '../../data/realtime'
import type { FetchResult } from '../../data/realtimeFetch'
import { nextDelayMs, WARMING_LIMIT } from './backoff'
import { clockNow, SNAPSHOT_MAX_AGE_S, updateClockOffset } from './clock'

/** What the poller remembers between polls. */
export interface PollState {
  /** Latest good snapshot; dropped when failures outlast SNAPSHOT_MAX_AGE_S. */
  snapshot: RealtimeSnapshot | null
  /** Live-clock offset (clock.ts); null until the first snapshot. */
  offsetS: number | null
  /** Consecutive failed polls. */
  failures: number
  /** Consecutive "warming" responses; kept until a success, so a Worker stuck warming counts as failing. */
  warmings: number
  /** The Worker speaks another snapshot version; sticky until a poll succeeds. */
  schemaMismatch: boolean
  lastError: string | null
  cache: string | null
}

export const INITIAL_POLL_STATE: PollState = {
  snapshot: null,
  offsetS: null,
  failures: 0,
  warmings: 0,
  schemaMismatch: false,
  lastError: null,
  cache: null,
}

export interface PollStep {
  next: PollState
  delayMs: number
  /** What to log, if anything: every failure is, a warming Worker is a warning. */
  log: { level: 'warn' | 'error'; message: string } | null
  /** Whether the UI state should change (a warming Worker that is still within its limit is not news). */
  publish: boolean
}

export interface PollContext {
  /** performance.now() when the response's headers arrived (any time on the same clock for failures). */
  perfNowMs: number
  /** Date.now() / 1000: a coarse guard for a first snapshot that is already old. */
  wallNowS: number
  random: () => number
}

/** A thrown error that isn't our own abort is a failed poll like any other. */
export function resultFromThrown(err: unknown): FetchResult {
  return { ok: false, warming: false, schemaMismatch: false, error: err instanceof Error ? err.message : String(err), retryAfterS: null }
}

/**
 * Folds one poll result into the poller state and decides the next delay. Pure: the hook does the
 * logging, state publishing and timer. A success older than SNAPSHOT_MAX_AGE_S is a failure: relative
 * to the live clock when there is one, else (the first poll) to the device clock.
 */
export function applyPollResult(state: PollState, result: FetchResult, ctx: PollContext): PollStep {
  if (result.ok) {
    const { snapshot } = result
    const offsetS = updateClockOffset(state.offsetS, snapshot.generatedAt, result.receivedPerfMs)
    const ageS =
      state.offsetS === null ? ctx.wallNowS - snapshot.generatedAt : clockNow(offsetS, result.receivedPerfMs) - snapshot.generatedAt
    if (ageS <= SNAPSHOT_MAX_AGE_S) {
      return {
        next: { snapshot, offsetS, failures: 0, warmings: 0, schemaMismatch: false, lastError: null, cache: result.cache },
        delayMs: nextDelayMs({ kind: 'ok' }, ctx.random),
        log: null,
        publish: true,
      }
    }
    return failed({ ...state, offsetS }, `snapshot is ${Math.round(ageS)} s old`, null, false, ctx)
  }

  if (result.warming) {
    const warmings = state.warmings + 1
    if (warmings <= WARMING_LIMIT) {
      return {
        next: { ...state, warmings },
        delayMs: nextDelayMs({ kind: 'warming', retryAfterS: result.retryAfterS, warmings }, ctx.random),
        log: { level: 'warn', message: `Realtime Worker is warming (${warmings}/${WARMING_LIMIT}), retrying` },
        publish: false,
      }
    }
    return failed({ ...state, warmings }, result.error, result.retryAfterS, result.schemaMismatch, ctx)
  }
  return failed(state, result.error, result.retryAfterS, result.schemaMismatch, ctx)
}

function failed(state: PollState, error: string, retryAfterS: number | null, schemaMismatch: boolean, ctx: PollContext): PollStep {
  const failures = state.failures + 1
  const tooOld =
    state.snapshot !== null &&
    state.offsetS !== null &&
    clockNow(state.offsetS, ctx.perfNowMs) - state.snapshot.generatedAt > SNAPSHOT_MAX_AGE_S
  return {
    next: {
      ...state,
      snapshot: tooOld ? null : state.snapshot,
      failures,
      schemaMismatch: state.schemaMismatch || schemaMismatch,
      lastError: error,
    },
    delayMs: nextDelayMs({ kind: 'error', retryAfterS, failures }, ctx.random),
    log: { level: 'error', message: `Realtime poll failed (${failures} in a row): ${error}` },
    publish: true,
  }
}
