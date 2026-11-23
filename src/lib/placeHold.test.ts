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
