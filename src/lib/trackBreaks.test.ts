import { describe, expect, it } from 'vitest'
import { NO_BANDS } from './corridors'
import { lineBreaks } from './trackBreaks'
import { EMPTY_PROFILE, profileAt, type TrackProfile } from './trackProfile'

const profile = (d: number[], y: number[]): TrackProfile => ({ d: Float64Array.from(d), y: Float64Array.from(y) })

describe('lineBreaks', () => {
  it('is empty for a flat shape with no bands', () => {
    expect(lineBreaks(EMPTY_PROFILE, NO_BANDS, new Map(), 's')).toEqual([])
  })

  it('keeps a taper break only once the slot has moved a quarter slot, and always the ends', () => {
    const slot = profile([1000, 1300, 2000, 2300], [0, 1, 1, -1])
    const breaks = lineBreaks(EMPTY_PROFILE, { slot, half: EMPTY_PROFILE }, new Map(), 's')
    for (const knot of slot.d) expect(breaks).toContain(knot)
    const inner = breaks.filter((d) => !slot.d.includes(d))
    // Fewer than the 30 m grid's 9 + 9, but enough for the eases' steep middles.
    expect(inner.length).toBeLessThan(18)
    expect(inner.filter((d) => d > 2000).length).toBeGreaterThan(inner.filter((d) => d < 1300).length)
    const values = breaks.map((d) => profileAt(slot, d))
    for (let i = 1; i < breaks.length; i++) {
      if (slot.d.includes(breaks[i]!)) continue
      expect(Math.abs(values[i]! - values[i - 1]!)).toBeGreaterThanOrEqual(0.25)
    }
  })
})
