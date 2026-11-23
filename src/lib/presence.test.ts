import { describe, expect, it } from 'vitest'
import { admitShown, mergeShown, newPresence, PRESENCE_S, stepPresence, withoutFaded } from './presence'

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

describe('admitShown', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((stationId) => ({ stationId }))

  it('admits every wanted layer while there is room, and keeps prev when nothing changed', () => {
    const first = admitShown([], [a!, b!], 4)
    expect(first.drawn).toEqual([a, b])
    expect(admitShown(first.shown, [a!, b!], 4).shown).toBe(first.shown)
  })

  it('keeps leaving layers mounted and holds a joining one out while they fill the slots', () => {
    const shown = [a!, b!, c!, d!]
    const r = admitShown(shown, [e!, a!], 4)
    // b, c and d leave and a stays: four slots held, so e waits.
    expect(r.drawn).toEqual([a])
    expect(r.shown).toEqual([a, b, c, d])
    // Once one has faded, e joins.
    const later = admitShown(withoutFaded(r.shown, r.drawn, 'b'), [e!, a!], 4)
    expect(later.drawn).toEqual([e, a])
    expect(later.shown).toEqual([e, a, c, d])
  })

  it('takes the wanted objects for layers already shown, in wanted order', () => {
    const b2 = { stationId: 'b' }
    const r = admitShown([a!, b!], [b2, a!], 4)
    expect(r.drawn[0]).toBe(b2)
    expect(r.shown).toEqual([b2, a])
  })
})

describe('admitShown for the focused layer', () => {
  const [a, b, c, d, f] = ['a', 'b', 'c', 'd', 'f'].map((stationId) => ({ stationId }))

  it('drops the oldest leaving layer at once rather than make the focused one wait', () => {
    // a left first (it sits last), then b, c and d: every slot is held by a leaving layer.
    const prev = [d!, c!, b!, a!]
    expect(admitShown(prev, [f!], 4).drawn).toEqual([])
    const r = admitShown(prev, [f!], 4, true)
    expect(r.drawn).toEqual([f])
    expect(r.shown).toEqual([f, d, c, b])
  })

  it('drops only as many as it needs, and none when there is room or it is already shown', () => {
    expect(admitShown([c!, b!, a!], [f!], 4, true).shown).toEqual([f, c, b, a])
    const shown = [f!, d!, c!, b!]
    expect(admitShown(shown, [f!], 4, true).shown).toBe(shown)
  })

  it('still holds a later joining layer out', () => {
    const r = admitShown([d!, c!, b!, a!], [f!, a!, { stationId: 'g' }], 4, true)
    expect(r.drawn.map((m) => m.stationId)).toEqual(['f', 'a'])
  })
})
