import { describe, expect, it } from 'vitest'
import { createBucket, msUntilToken, tryTake } from './rateLimit'

describe('token buckets', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const b = createBucket(3, 1, 0)
    expect([0, 0, 0, 0].map(() => tryTake([b], 0))).toEqual([true, true, true, false])
  })

  it('refills at the rate, capped at capacity', () => {
    const b = createBucket(2, 0.5, 0)
    tryTake([b], 0)
    tryTake([b], 0)
    expect(tryTake([b], 1000)).toBe(false)
    expect(tryTake([b], 2000)).toBe(true)
    expect(tryTake([b], 1_000_000)).toBe(true)
    expect(b.tokens).toBeCloseTo(1)
    expect(tryTake([b], 1_000_000)).toBe(true)
    expect(tryTake([b], 1_000_000)).toBe(false)
  })

  it('takes from every bucket or none', () => {
    const upstream = createBucket(5, 1, 0)
    const photon = createBucket(1, 0.1, 0)
    expect(tryTake([upstream, photon], 0)).toBe(true)
    expect(tryTake([upstream, photon], 0)).toBe(false)
    expect(upstream.tokens).toBe(4)
  })

  it('says how long until a token, the longest wait of the buckets', () => {
    const upstream = createBucket(1, 2, 0)
    const photon = createBucket(1, 0.5, 0)
    expect(msUntilToken([upstream, photon], 0)).toBe(0)
    tryTake([upstream, photon], 0)
    expect(msUntilToken([upstream], 0)).toBe(500)
    expect(msUntilToken([upstream, photon], 0)).toBe(2000)
    expect(msUntilToken([upstream, photon], 1000)).toBe(1000)
  })

  it('ignores a clock that steps back', () => {
    const b = createBucket(2, 1, 1000)
    tryTake([b], 1000)
    tryTake([b], 1000)
    expect(tryTake([b], 0)).toBe(false)
  })
})
