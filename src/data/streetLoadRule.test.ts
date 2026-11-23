import { describe, expect, it } from 'vitest'
import { PARTIAL_RETRY_MS, requestDue } from './streetLoadRule'

describe('requestDue', () => {
  it('asks for a key never loaded', () => {
    expect(requestDue(undefined, false, false, 0)).toBe(true)
  })

  it('never asks while a load is in flight', () => {
    expect(requestDue(undefined, true, false, 0)).toBe(false)
    expect(requestDue({ missing: 1, at: 0 }, true, false, 1e9)).toBe(false)
  })

  it('never asks again for a whole layer', () => {
    expect(requestDue({ missing: 0, at: 0 }, false, false, 1e9)).toBe(false)
  })

  it('asks again for a layer missing a member only once it is PARTIAL_RETRY_MS old', () => {
    expect(requestDue({ missing: 1, at: 1000 }, false, false, 1000 + PARTIAL_RETRY_MS - 1)).toBe(false)
    expect(requestDue({ missing: 1, at: 1000 }, false, false, 1000 + PARTIAL_RETRY_MS)).toBe(true)
  })

  it('asks again for a failed key at once, unless a view-driven caller\'s failure is recent', () => {
    expect(requestDue(undefined, false, false, 5)).toBe(true)
    expect(requestDue(undefined, false, true, 5)).toBe(false)
  })
})
