import { describe, expect, it } from 'vitest'
import { VIEW_RETRY_MS } from '../lib/viewStations'
import { PARTIAL_RETRY_MS, requestDue } from './streetLoadRule'

describe('requestDue', () => {
  it('asks for a key never loaded', () => {
    expect(requestDue(undefined, false, undefined, 0, false)).toBe(true)
    expect(requestDue(undefined, false, undefined, 0, true)).toBe(true)
  })

  it('never asks while a load is in flight', () => {
    expect(requestDue(undefined, true, undefined, 0, false)).toBe(false)
    expect(requestDue({ missing: 1, at: 0 }, true, undefined, 1e9, false)).toBe(false)
  })

  it('never asks again for a whole layer', () => {
    expect(requestDue({ missing: 0, at: 0 }, false, undefined, 1e9, false)).toBe(false)
    expect(requestDue({ missing: 0, at: 0 }, false, undefined, 1e9, true)).toBe(false)
  })

  it('asks again for a layer missing a member once it is PARTIAL_RETRY_MS old', () => {
    expect(requestDue({ missing: 1, at: 1000 }, false, undefined, 1000 + PARTIAL_RETRY_MS - 1, false)).toBe(false)
    expect(requestDue({ missing: 1, at: 1000 }, false, undefined, 1000 + PARTIAL_RETRY_MS, false)).toBe(true)
  })

  it('holds a partial layer for VIEW_RETRY_MS for a view-driven caller', () => {
    expect(requestDue({ missing: 1, at: 1000 }, false, undefined, 1000 + PARTIAL_RETRY_MS, true)).toBe(false)
    expect(requestDue({ missing: 1, at: 1000 }, false, undefined, 1000 + VIEW_RETRY_MS - 1, true)).toBe(false)
    expect(requestDue({ missing: 1, at: 1000 }, false, undefined, 1000 + VIEW_RETRY_MS, true)).toBe(true)
  })

  it('asks again for a failed key at once, or for a view-driven caller once VIEW_RETRY_MS old', () => {
    expect(requestDue(undefined, false, 100, 101, false)).toBe(true)
    expect(requestDue(undefined, false, 100, 100 + VIEW_RETRY_MS - 1, true)).toBe(false)
    expect(requestDue(undefined, false, 100, 100 + VIEW_RETRY_MS, true)).toBe(true)
  })
})
