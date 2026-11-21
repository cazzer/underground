import { describe, expect, it } from 'vitest'
import { FEED_IDS, RT_SCHEMA_VERSION, type RealtimeSnapshot } from '../../data/realtime'
import type { FetchResult } from '../../data/realtimeFetch'
import { POLL_MS, WARMING_LIMIT } from './backoff'
import { SNAPSHOT_MAX_AGE_S } from './clock'
import { applyPollResult, INITIAL_POLL_STATE, resultFromThrown, type PollState, type PollStep } from './pollOutcome'

const GEN = 1_795_228_554
const mid = () => 0.5

function snapshot(generatedAt: number): RealtimeSnapshot {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => [id, { headerTimestamp: generatedAt, error: null, stale: false, droppedEntities: 0, trips: [] }]),
  ) as unknown as RealtimeSnapshot['feeds']
  return { version: RT_SCHEMA_VERSION, generatedAt, feeds }
}
const ok = (generatedAt: number, receivedPerfMs: number): FetchResult => ({
  ok: true,
  snapshot: snapshot(generatedAt),
  receivedPerfMs,
  cache: 'HIT',
})
const bad = (over: Partial<Extract<FetchResult, { ok: false }>> = {}): FetchResult => ({
  ok: false,
  warming: false,
  schemaMismatch: false,
  error: 'HTTP 500',
  retryAfterS: null,
  ...over,
})
/** Applies results in order, with the device clock matching the live clock. */
function run(results: [FetchResult, number?][], from: PollState = INITIAL_POLL_STATE): { state: PollState; steps: PollStep[] } {
  let state = from
  const steps: PollStep[] = []
  for (const [result, perfMs = 1000] of results) {
    const step = applyPollResult(state, result, { perfNowMs: perfMs, wallNowS: GEN + perfMs / 1000, random: mid })
    steps.push(step)
    state = step.next
  }
  return { state, steps }
}

describe('applyPollResult success', () => {
  it('takes the snapshot, sets the clock offset and schedules the next poll', () => {
    const { state, steps } = run([[ok(GEN, 5000)]])
    expect(state).toMatchObject({ failures: 0, warmings: 0, schemaMismatch: false, lastError: null, cache: 'HIT' })
    expect(state.snapshot?.generatedAt).toBe(GEN)
    expect(state.offsetS).toBe(GEN - 5)
    expect(steps[0]).toMatchObject({ delayMs: POLL_MS, log: null, publish: true })
  })

  it('treats a snapshot older than the limit as a failure, by the live clock', () => {
    const fresh = run([[ok(GEN, 1000)]]).state
    // 200 s later the Worker answers with the snapshot it made 130 s ago.
    const { state, steps } = run([[ok(GEN + 70, 201_000)]], fresh)
    expect(state.failures).toBe(1)
    expect(state.lastError).toMatch(/snapshot is \d+ s old/)
    expect(state.snapshot?.generatedAt).toBe(GEN) // the old good one is kept until it is itself too old
    expect(steps[0]!.log?.level).toBe('error')
  })

  it('accepts a snapshot right at the age limit', () => {
    const fresh = run([[ok(GEN, 1000)]]).state
    expect(run([[ok(GEN + 20, 1000 + (20 + SNAPSHOT_MAX_AGE_S) * 1000)]], fresh).state.failures).toBe(0)
  })

  it('rejects a first snapshot that is already older than the limit by the device clock', () => {
    const { state } = run([[ok(GEN - SNAPSHOT_MAX_AGE_S - 30, 1000)]])
    expect(state.failures).toBe(1)
    expect(state.snapshot).toBeNull()
  })

  it('clears failures, warmings and a schema mismatch', () => {
    const failing = run([[bad({ schemaMismatch: true })], [bad({ warming: true })]]).state
    expect(failing.schemaMismatch).toBe(true)
    const { state } = run([[ok(GEN, 5000)]], failing)
    expect(state).toMatchObject({ failures: 0, warmings: 0, schemaMismatch: false, lastError: null })
  })
})

describe('applyPollResult failure', () => {
  it('counts failures, logs each, and backs off', () => {
    const { state, steps } = run([[bad()], [bad()], [bad()]])
    expect(state.failures).toBe(3)
    expect(steps.map((s) => s.delayMs)).toEqual([2000, 4000, 8000])
    expect(steps.every((s) => s.log?.level === 'error' && s.publish)).toBe(true)
  })

  it('drops the snapshot once failures outlast the age limit', () => {
    const fresh = run([[ok(GEN, 1000)]]).state
    expect(run([[bad(), 1000 + 60_000]], fresh).state.snapshot).not.toBeNull()
    expect(run([[bad(), 1000 + (SNAPSHOT_MAX_AGE_S + 1) * 1000]], fresh).state.snapshot).toBeNull()
  })

  it('honors Retry-After', () => {
    expect(run([[bad({ retryAfterS: 30 })]]).steps[0]!.delayMs).toBe(30_000)
  })

  it('keeps a schema mismatch set through later failures, until a success', () => {
    const { state } = run([[bad({ schemaMismatch: true })], [bad()], [bad({ warming: true })]])
    expect(state.schemaMismatch).toBe(true)
  })

  it('turns a thrown error into a failure rather than rethrowing', () => {
    const { state } = run([[resultFromThrown(new TypeError('Failed to fetch'))]])
    expect(state).toMatchObject({ failures: 1, lastError: 'Failed to fetch' })
    expect(resultFromThrown('odd')).toMatchObject({ ok: false, error: 'odd' })
  })
})

describe('applyPollResult warming', () => {
  const warm = () => bad({ warming: true, error: 'HTTP 503 warming' })

  it('retries quietly within the limit', () => {
    const { state, steps } = run([[warm()], [warm()]])
    expect(state).toMatchObject({ failures: 0, warmings: 2 })
    expect(steps.every((s) => !s.publish && s.log?.level === 'warn' && s.delayMs === 1000)).toBe(true)
  })

  it('counts as a failure past the limit, and keeps counting until a success', () => {
    const results: [FetchResult][] = Array.from({ length: WARMING_LIMIT + 1 }, () => [warm()])
    const past = run(results)
    expect(past.state.failures).toBe(1)
    expect(past.steps.at(-1)!.publish).toBe(true)
    // A different failure in between does not reset the warming count.
    const { state, steps } = run([[bad()], [warm()]], past.state)
    expect(state.warmings).toBeGreaterThan(WARMING_LIMIT)
    expect(steps[1]!.log?.level).toBe('error')
    expect(state.failures).toBe(3)
    // Only a success starts it over.
    expect(run([[ok(GEN, 1000)], [warm()]], state).state.warmings).toBe(1)
  })
})
