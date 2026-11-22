import { describe, expect, it } from 'vitest'
import type { EneFetchResult } from '../../data/eneFetch'
import type { EneSnapshot } from '../../data/realtime'
import { BACKOFF_BASE_MS, WARMING_LIMIT } from './backoff'
import { ENE_MAX_AGE_S } from './eneJoin'
import { applyEnePoll, ENE_POLL_MS, INITIAL_ENE_STATE, type EnePollState } from './enePoll'

const NOW = 2_000_000
const snap = (generatedAt: number): EneSnapshot => ({ version: 1, generatedAt, dropped: 0, outages: [] })
const ok = (generatedAt: number): EneFetchResult => ({ ok: true, snapshot: snap(generatedAt) })
const fail = (over: Partial<Extract<EneFetchResult, { ok: false }>> = {}): EneFetchResult => ({
  ok: false,
  warming: false,
  schemaMismatch: false,
  error: 'HTTP 500',
  retryAfterS: null,
  ...over,
})
const mid = () => 0.5 // jitter factor exactly 1

describe('applyEnePoll', () => {
  it('a success stores the snapshot, resets the counts and waits ENE_POLL_MS', () => {
    const dirty: EnePollState = { ...INITIAL_ENE_STATE, failures: 3, warmings: 2, schemaMismatch: true, lastError: 'x' }
    const step = applyEnePoll(dirty, ok(NOW - 10), mid, NOW)
    expect(step.next).toEqual({ snapshot: snap(NOW - 10), failures: 0, warmings: 0, schemaMismatch: false, lastError: null })
    expect(step).toMatchObject({ delayMs: ENE_POLL_MS, log: null, publish: true })
  })

  it('an older body does not replace a newer snapshot', () => {
    const state = { ...INITIAL_ENE_STATE, snapshot: snap(NOW - 10) }
    expect(applyEnePoll(state, ok(NOW - 50), mid, NOW).next.snapshot?.generatedAt).toBe(NOW - 10)
  })

  it('a body already too old is stored with a warning and the normal delay', () => {
    const step = applyEnePoll(INITIAL_ENE_STATE, ok(NOW - ENE_MAX_AGE_S - 1), mid, NOW)
    expect(step.next.snapshot).not.toBeNull()
    expect(step.log?.level).toBe('warn')
    expect(step.delayMs).toBe(ENE_POLL_MS)
  })

  it('warming within the limit is not published and retries soon; past it, it fails', () => {
    let state = INITIAL_ENE_STATE
    for (let n = 1; n <= WARMING_LIMIT; n++) {
      const step = applyEnePoll(state, fail({ warming: true, retryAfterS: 2 }), mid, NOW)
      expect(step).toMatchObject({ publish: false, delayMs: 2000 })
      expect(step.next.failures).toBe(0)
      state = step.next
    }
    const step = applyEnePoll(state, fail({ warming: true }), mid, NOW)
    expect(step).toMatchObject({ publish: true })
    expect(step.next.failures).toBe(1)
    expect(step.log?.level).toBe('error')
  })

  it('a failure backs off, keeps the snapshot, and publishes', () => {
    const state = { ...INITIAL_ENE_STATE, snapshot: snap(NOW - 10) }
    const one = applyEnePoll(state, fail(), mid, NOW)
    expect(one.next).toMatchObject({ failures: 1, lastError: 'HTTP 500' })
    expect(one.next.snapshot).toBe(state.snapshot)
    expect(one).toMatchObject({ delayMs: BACKOFF_BASE_MS, publish: true })
    expect(applyEnePoll(one.next, fail(), mid, NOW).delayMs).toBe(BACKOFF_BASE_MS * 2)
  })

  it('a schema mismatch sticks through other failures until a success', () => {
    const mismatch = applyEnePoll(INITIAL_ENE_STATE, fail({ schemaMismatch: true }), mid, NOW).next
    expect(mismatch.schemaMismatch).toBe(true)
    const later = applyEnePoll(mismatch, fail(), mid, NOW).next
    expect(later.schemaMismatch).toBe(true)
    expect(applyEnePoll(later, ok(NOW), mid, NOW).next.schemaMismatch).toBe(false)
  })
})
