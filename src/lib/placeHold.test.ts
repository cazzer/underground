import { describe, expect, it } from 'vitest'
import { holdOnFlight, holdOnPointer, holdsFocus, newPlaceHold, releaseHold } from './placeHold'

const place = { kind: 'point', source: 'place' } as const
const down = (id: number, x = 100, y = 100, touch = false) => ({ type: 'down', id, x, y, touch, primary: true }) as const
const move = (id: number, x: number, y: number) => ({ type: 'move', id, x, y }) as const

describe('place hold', () => {
  it('is off until a place flight', () => {
    expect(holdsFocus(newPlaceHold())).toBe(false)
  })

  it('holds from a place flight', () => {
    const h = newPlaceHold()
    holdOnFlight(h, place)
    expect(holdsFocus(h)).toBe(true)
  })

  it('ends on any other flight: a station, a location fix', () => {
    for (const other of [{ kind: 'station' }, { kind: 'point', source: 'locate' }] as const) {
      const h = newPlaceHold()
      holdOnFlight(h, place)
      holdOnFlight(h, other)
      expect(holdsFocus(h), other.kind).toBe(false)
    }
  })

  it('a new place re-arms it after the user moved the view', () => {
    const h = newPlaceHold()
    holdOnFlight(h, place)
    holdOnPointer(h, { type: 'wheel' })
    expect(holdsFocus(h)).toBe(false)
    holdOnFlight(h, place)
    expect(holdsFocus(h)).toBe(true)
  })

  it('survives a tap and small jitter, ends on a drag past the slop', () => {
    const h = newPlaceHold()
    holdOnFlight(h, place)
    holdOnPointer(h, down(1))
    holdOnPointer(h, move(1, 104, 103))
    holdOnPointer(h, { type: 'up', id: 1 })
    expect(holdsFocus(h)).toBe(true)
    holdOnPointer(h, down(2))
    holdOnPointer(h, move(2, 100, 107))
    expect(holdsFocus(h)).toBe(false)
  })

  it('uses the touch slop for a finger', () => {
    const h = newPlaceHold()
    holdOnFlight(h, place)
    holdOnPointer(h, down(1, 0, 0, true))
    holdOnPointer(h, move(1, 8, 0))
    expect(holdsFocus(h)).toBe(true)
    holdOnPointer(h, move(1, 11, 0))
    expect(holdsFocus(h)).toBe(false)
  })

  it('ends on a second finger and on a wheel step', () => {
    const pinch = newPlaceHold()
    holdOnFlight(pinch, place)
    holdOnPointer(pinch, down(1, 0, 0, true))
    expect(holdsFocus(pinch)).toBe(true)
    holdOnPointer(pinch, { type: 'down', id: 2, x: 50, y: 50, touch: true, primary: false })
    expect(holdsFocus(pinch)).toBe(false)
    const wheel = newPlaceHold()
    holdOnFlight(wheel, place)
    holdOnPointer(wheel, { type: 'wheel' })
    expect(holdsFocus(wheel)).toBe(false)
  })

  it('releaseHold ends it', () => {
    const h = newPlaceHold()
    holdOnFlight(h, place)
    releaseHold(h)
    expect(holdsFocus(h)).toBe(false)
  })
})

/**
 * The hold's own rules, spelled out in numbers so they don't ride on locationCap.ts: the hold reuses the cap's
 * detector, which is about what tile requests reveal and may change for that reason. If one of these fails after a
 * change there, decide on purpose whether auto-focus should follow it, and then edit the hold, not just this test.
 */
describe('which events end the hold (pinned, not inherited)', () => {
  const armed = () => {
    const h = newPlaceHold()
    holdOnFlight(h, place)
    return h
  }
  const ends = (events: Parameters<typeof holdOnPointer>[1][]): boolean => {
    const h = armed()
    for (const e of events) holdOnPointer(h, e)
    return !holdsFocus(h)
  }

  it('a mouse drag ends it past 6 px, not at 6 px', () => {
    expect(ends([down(1), move(1, 106, 100)])).toBe(false)
    expect(ends([down(1), move(1, 106.5, 100)])).toBe(true)
  })

  it('a touch drag ends it past 10 px, not at 10 px', () => {
    expect(ends([down(1, 0, 0, true), move(1, 0, 10)])).toBe(false)
    expect(ends([down(1, 0, 0, true), move(1, 0, 10.5)])).toBe(true)
  })

  it('measures from where the press started, not from the last move', () => {
    expect(ends([down(1), move(1, 104, 100), move(1, 108, 100)])).toBe(true)
  })

  it('a press that never moves, ends or is lost leaves it', () => {
    expect(ends([down(1), { type: 'up', id: 1 }])).toBe(false)
    expect(ends([down(1), { type: 'blur' }, move(1, 300, 300)])).toBe(false)
    expect(ends([move(9, 300, 300)])).toBe(false)
  })

  it('a second simultaneous contact ends it; two taps one after the other do not', () => {
    expect(ends([down(1, 0, 0, true), { type: 'down', id: 2, x: 5, y: 5, touch: true, primary: false }])).toBe(true)
    expect(ends([down(1), { type: 'up', id: 1 }, down(2), { type: 'up', id: 2 }])).toBe(false)
  })

  it('any wheel step ends it', () => {
    expect(ends([{ type: 'wheel' }])).toBe(true)
  })

  it('a place flight, a station flight and a release behave as the rules say', () => {
    const h = armed()
    holdOnFlight(h, { kind: 'station' })
    expect(holdsFocus(h)).toBe(false)
    holdOnFlight(h, place)
    expect(holdsFocus(h)).toBe(true)
    holdOnFlight(h, { kind: 'point', source: 'locate' })
    expect(holdsFocus(h)).toBe(false)
  })
})
