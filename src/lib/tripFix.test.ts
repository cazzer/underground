import { describe, expect, it } from 'vitest'
import { afterFocus, afterPick, fixEndOf } from './tripFix'

describe('the fix-filled trip end', () => {
  const ends = { from: 'L08', to: 'B' }

  it('is the end holding the fix station, or none', () => {
    expect(fixEndOf(ends, 'L08')).toBe('from')
    expect(fixEndOf(ends, null)).toBeNull()
    expect(fixEndOf(ends, 'Z')).toBeNull()
  })

  it('clears when the visitor picks that station for its own end', () => {
    expect(afterPick('L08', 'L08')).toBeNull()
  })

  it('is no end once another station is picked for it', () => {
    const fix = afterPick('L08', 'A')
    expect(fixEndOf({ ...ends, from: 'A' }, fix)).toBeNull()
  })

  it('moves to To with a swap', () => {
    expect(fixEndOf({ from: ends.to, to: ends.from }, 'L08')).toBe('to')
  })

  it('clears when the visitor focuses it, and only it', () => {
    expect(afterFocus('L08', 'L08')).toBeNull()
    expect(afterFocus('L08', 'B')).toBe('L08')
    expect(afterFocus('L08', null)).toBe('L08')
  })

  it('clears when the visitor picks the fix station as the other end', () => {
    // From was L08 from the fix; picking L08 for To chooses it.
    const fix = afterPick('L08', 'L08')
    expect(fixEndOf({ from: 'A', to: 'L08' }, fix)).toBeNull()
  })
})
