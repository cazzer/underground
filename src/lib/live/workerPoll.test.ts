import { describe, expect, it } from 'vitest'
import type { WorkerFetchResult } from '../../data/workerFetch'
import { applyWorkerPoll, initialPollState, type PollPolicy } from './workerPoll'

interface Snap {
  generatedAt: number
}

const NOW = 2_000_000
const POLICY: PollPolicy = { pollMs: 60_000, maxAgeS: 300, label: 'Alerts' }
const ok = (generatedAt: number): WorkerFetchResult<Snap> => ({ ok: true, snapshot: { generatedAt } })
const fail: WorkerFetchResult<Snap> = { ok: false, warming: false, schemaMismatch: false, error: 'HTTP 500', retryAfterS: null }
const mid = () => 0.5

describe('applyWorkerPoll', () => {
  it('waits the policy delay after a success and names the route in its logs', () => {
    const step = applyWorkerPoll(initialPollState<Snap>(), ok(NOW - 10), mid, NOW, POLICY)
    expect(step).toMatchObject({ delayMs: 60_000, log: null, publish: true })
    const old = applyWorkerPoll(initialPollState<Snap>(), ok(NOW - 301), mid, NOW, POLICY)
    expect(old.log).toEqual({ level: 'warn', message: 'Alerts data is 301 s old, not shown' })
    const failed = applyWorkerPoll(initialPollState<Snap>(), fail, mid, NOW, POLICY)
    expect(failed.log).toEqual({ level: 'error', message: 'Alerts poll failed (1 in a row): HTTP 500' })
  })

  it('keeps a newer snapshot over an older body', () => {
    const state = { ...initialPollState<Snap>(), snapshot: { generatedAt: NOW - 10 } }
    expect(applyWorkerPoll(state, ok(NOW - 50), mid, NOW, POLICY).next.snapshot?.generatedAt).toBe(NOW - 10)
  })
})
