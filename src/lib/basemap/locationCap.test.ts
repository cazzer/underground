import { describe, expect, it } from 'vitest'
import { capStep, newCap, type CapEvent } from './locationCap'

const capped = () => {
  const s = newCap()
  capStep(s, { type: 'pointFlight' })
  return s
}
const down = (id: number, x: number, y: number, touch = false, primary = true): CapEvent => ({ type: 'down', id, x, y, touch, primary })

describe('capStep', () => {
  it('caps on a location point flight', () => {
    expect(capped().capped).toBe(true)
    expect(newCap().capped).toBe(false)
  })

  it('keeps the cap through a tap that does not move past the slop', () => {
    const s = capped()
    expect(capStep(s, down(1, 100, 100))).toBe(false)
    expect(capStep(s, { type: 'move', id: 1, x: 104, y: 104 })).toBe(false)
    expect(capStep(s, { type: 'up', id: 1 })).toBe(false)
    expect(s.capped).toBe(true)
  })

  it('lifts on a mouse drag past 6 px, a touch drag past 10 px', () => {
    const m = capped()
    capStep(m, down(1, 0, 0))
    expect(capStep(m, { type: 'move', id: 1, x: 6.1, y: 0 })).toBe(true)
    expect(m.capped).toBe(false)
    const t = capped()
    capStep(t, down(2, 0, 0, true))
    expect(capStep(t, { type: 'move', id: 2, x: 9, y: 0 })).toBe(false)
    expect(capStep(t, { type: 'move', id: 2, x: 10.1, y: 0 })).toBe(true)
  })

  it('lifts on a second finger, a wheel step or a station pick', () => {
    const p = capped()
    capStep(p, down(1, 0, 0, true))
    expect(capStep(p, down(2, 50, 50, true, false))).toBe(true)
    const w = capped()
    expect(capStep(w, { type: 'wheel' })).toBe(true)
    const st = capped()
    expect(capStep(st, { type: 'station' })).toBe(true)
  })

  it('ignores hover moves and presses that ended, and reports a lift only once', () => {
    const s = capped()
    expect(capStep(s, { type: 'move', id: 7, x: 500, y: 500 })).toBe(false)
    capStep(s, down(1, 0, 0))
    capStep(s, { type: 'up', id: 1 })
    expect(capStep(s, { type: 'move', id: 1, x: 100, y: 0 })).toBe(false)
    expect(capStep(s, { type: 'wheel' })).toBe(true)
    expect(capStep(s, { type: 'wheel' })).toBe(false)
  })

  it('forgets a stale press when a new primary press starts, so it is not a pinch', () => {
    const s = capped()
    capStep(s, down(1, 0, 0, true))
    expect(capStep(s, down(2, 0, 0, true, true))).toBe(false)
    expect(s.capped).toBe(true)
  })

  it('drops presses when the window loses focus', () => {
    const s = capped()
    capStep(s, down(1, 0, 0))
    capStep(s, { type: 'blur' })
    expect(capStep(s, { type: 'move', id: 1, x: 100, y: 0 })).toBe(false)
    expect(capStep(s, down(2, 0, 0, false, false))).toBe(false)
    expect(s.capped).toBe(true)
  })
})
