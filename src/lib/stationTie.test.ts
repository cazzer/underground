import { describe, expect, it } from 'vitest'
import { focusedTie, STUB_DEPTH_M } from './stationTie'

describe('focusedTie', () => {
  it('drops the tie of a station its interior marks, whether or not it has a depth', () => {
    expect(focusedTie(true, false)).toBe('drop')
    expect(focusedTie(false, false)).toBe('drop')
  })
  it('keeps a fallback station tie to its track depth', () => {
    expect(focusedTie(true, true)).toBe('keep')
  })
  it('gives a fallback station with no depth a stub', () => {
    expect(focusedTie(false, true)).toBe('stub')
  })
  it('keeps the stub short', () => {
    expect(STUB_DEPTH_M).toBeGreaterThan(0)
    expect(STUB_DEPTH_M).toBeLessThan(30)
  })
})
