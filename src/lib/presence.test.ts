import { describe, expect, it } from 'vitest'
import { mergeShown, newPresence, PRESENCE_S, stepPresence, withoutFaded } from './presence'

describe('stepPresence', () => {
  it('eases from 0 to 1 over PRESENCE_S and back', () => {
    const p = newPresence('L08')
    p.target = 1
    expect(stepPresence(p, PRESENCE_S / 2, false)).toBeCloseTo(0.5, 6)
    expect(stepPresence(p, PRESENCE_S / 4, false)).toBeCloseTo(0.84375, 6)
    expect(stepPresence(p, 1, false)).toBe(1)
    p.target = 0
    expect(stepPresence(p, PRESENCE_S / 4, false)).toBeCloseTo(0.84375, 6)
    expect(stepPresence(p, 1, false)).toBe(0)
  })

  it('turns back mid-way without jumping', () => {
    const p = newPresence('L08')
    p.target = 1
    stepPresence(p, PRESENCE_S / 4, false)
    const before = p.value
    p.target = 0
    expect(stepPresence(p, 0, false)).toBe(before)
  })

  it('snaps under reduced motion and ignores a negative dt', () => {
    const p = newPresence('L08')
    p.target = 1
    expect(stepPresence(p, -1, false)).toBe(0)
    expect(stepPresence(p, 0, true)).toBe(1)
    p.target = 0
    expect(stepPresence(p, 0, true)).toBe(0)
  })
})

describe('mergeShown and withoutFaded', () => {
  const a = { stationId: 'a' }
  const b = { stationId: 'b' }
  const c = { stationId: 'c' }

  it('keeps a dropped interior after the new drawn set until it fades', () => {
    expect(mergeShown([a, b], [a, c])).toEqual([a, c, b])
    expect(mergeShown([a, c, b], [b, c])).toEqual([b, c, a])
  })

  it('returns the previous list when nothing changed', () => {
    const prev = [a, b]
    expect(mergeShown(prev, [a, b])).toBe(prev)
    expect(mergeShown([a, b, c], [a, b])).toEqual([a, b, c])
  })

  it('drops a faded interior unless it is drawn again', () => {
    const shown = [a, c, b]
    expect(withoutFaded(shown, [a, c], 'b')).toEqual([a, c])
    expect(withoutFaded(shown, [a, b], 'b')).toBe(shown)
    expect(withoutFaded(shown, [a], 'x')).toBe(shown)
  })
})
