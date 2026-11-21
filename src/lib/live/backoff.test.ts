import { describe, expect, it } from 'vitest'
import { BACKOFF_MAX_MS, nextDelayMs, POLL_MS } from './backoff'

const mid = () => 0.5

describe('nextDelayMs', () => {
  it('polls on the normal interval after success', () => {
    expect(nextDelayMs({ kind: 'ok' }, mid)).toBe(POLL_MS)
  })

  it('doubles the backoff per failure and caps it', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((failures) => nextDelayMs({ kind: 'error', retryAfterS: null, failures }, mid))
    expect(delays).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000])
  })

  it('jitters between 0.8x and 1.2x', () => {
    expect(nextDelayMs({ kind: 'error', retryAfterS: null, failures: 2 }, () => 0)).toBe(3200)
    expect(nextDelayMs({ kind: 'error', retryAfterS: null, failures: 2 }, () => 1)).toBeCloseTo(4800)
  })

  it('honors a longer Retry-After', () => {
    expect(nextDelayMs({ kind: 'error', retryAfterS: 30, failures: 1 }, mid)).toBe(30_000)
    expect(nextDelayMs({ kind: 'error', retryAfterS: 1, failures: 3 }, mid)).toBe(8000)
  })

  it('retries a warming Worker after a second unless told otherwise', () => {
    expect(nextDelayMs({ kind: 'warming', retryAfterS: null, warmings: 1 }, mid)).toBe(1000)
    expect(nextDelayMs({ kind: 'warming', retryAfterS: 5, warmings: 2 }, mid)).toBe(5000)
    expect(nextDelayMs({ kind: 'warming', retryAfterS: 0, warmings: 1 }, mid)).toBe(1000)
    expect(nextDelayMs({ kind: 'warming', retryAfterS: 9999, warmings: 1 }, mid)).toBe(BACKOFF_MAX_MS)
  })
})
