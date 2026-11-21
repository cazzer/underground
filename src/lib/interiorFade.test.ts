import { describe, expect, it } from 'vitest'
import type { Level } from '../data/stationSchema'
import { levelFadeShares } from './interiorFade'

const kinds = (...k: Level['kind'][]) => k.map((kind) => ({ kind }))

describe('levelFadeShares', () => {
  it('below ground (street first) is exactly i / (n - 1), the fade before elevated support', () => {
    for (let n = 2; n <= 6; n++) {
      const levels = kinds('street', ...Array.from({ length: n - 1 }, () => 'platform' as const))
      expect(levelFadeShares(levels)).toEqual(levels.map((_, i) => i / (n - 1)))
    }
    expect(levelFadeShares(kinds('street'))).toEqual([0])
  })
  it('fades by distance from the street, so an elevated station fades upward', () => {
    expect(levelFadeShares(kinds('platform', 'mezzanine', 'street'))).toEqual([1, 0.5, 0])
    expect(levelFadeShares(kinds('platform', 'street', 'mezzanine', 'platform'))).toEqual([0.5, 0, 0.5, 1])
  })
  it('throws without a street level', () => {
    expect(() => levelFadeShares(kinds('platform'))).toThrow(/no street level/)
  })
})
