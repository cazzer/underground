import { describe, expect, it } from 'vitest'
import { pingPong } from './pingPong'

describe('pingPong', () => {
  const L = 100

  it('starts at 0 and peaks at the length', () => {
    expect(pingPong(0, L)).toBe(0)
    expect(pingPong(L / 2, L)).toBe(L / 2)
    expect(pingPong(L, L)).toBe(L)
  })

  it('reflects on the way back', () => {
    expect(pingPong(1.5 * L, L)).toBe(0.5 * L)
    expect(pingPong(2 * L, L)).toBe(0)
  })

  it('wraps negative distances', () => {
    expect(pingPong(-0.5 * L, L)).toBe(0.5 * L)
  })

  it('returns 0, not NaN, for a zero length', () => {
    expect(pingPong(50, 0)).toBe(0)
  })
})
