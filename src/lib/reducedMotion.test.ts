import { describe, expect, it, vi } from 'vitest'
import { createReducedMotion } from './reducedMotion'

describe('createReducedMotion', () => {
  it('makes one query, lazily, and reads its matches live', () => {
    const list = { matches: false }
    const matchMedia = vi.fn(() => list)
    const read = createReducedMotion(() => ({ matchMedia }))
    expect(matchMedia).not.toHaveBeenCalled()
    expect(read()).toBe(false)
    list.matches = true
    expect(read()).toBe(true)
    expect(matchMedia).toHaveBeenCalledTimes(1)
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })
})
