import { describe, expect, it } from 'vitest'
import { addTurn, createTurnMeter, resetTurn } from './turnMeter'

describe('turn meter', () => {
  it('counts a steady turn by its net angle', () => {
    const m = createTurnMeter()
    for (let i = 0; i < 10; i++) addTurn(m, 0.04)
    expect(m.max).toBeCloseTo(0.4)
  })

  it('does not count drift one way and back twice', () => {
    const m = createTurnMeter()
    for (let i = 0; i < 10; i++) addTurn(m, 0.02)
    for (let i = 0; i < 10; i++) addTurn(m, -0.02)
    expect(m.max).toBeCloseTo(0.2)
    expect(m.net).toBeCloseTo(0)
  })

  it('keeps the largest net turn after a partial return', () => {
    const m = createTurnMeter()
    addTurn(m, 0.25)
    addTurn(m, -0.2)
    expect(addTurn(m, 0.1)).toBeCloseTo(0.25)
  })

  it('wraps a step across the seam to the short way', () => {
    const m = createTurnMeter()
    addTurn(m, -Math.PI + 0.1 - (Math.PI - 0.1))
    expect(m.max).toBeCloseTo(0.2)
  })

  it('starts over on reset', () => {
    const m = createTurnMeter()
    addTurn(m, 0.5)
    resetTurn(m)
    expect(addTurn(m, 0.1)).toBeCloseTo(0.1)
  })
})
