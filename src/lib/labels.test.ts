import { describe, expect, it } from 'vitest'
import { routeChipLabel, routeSpokenName, scheduleLabel } from './labels'

describe('routeChipLabel', () => {
  it('writes express variants as the base route plus a diamond', () => {
    expect(routeChipLabel('FX')).toBe('F◆')
    expect(routeChipLabel('6X')).toBe('6◆')
    expect(routeChipLabel('7X')).toBe('7◆')
  })

  it('leaves other names alone', () => {
    expect(routeChipLabel('A')).toBe('A')
    expect(routeChipLabel('S')).toBe('S')
    expect(routeChipLabel('SIR')).toBe('SIR')
  })
})

describe('routeSpokenName', () => {
  it('says express variants as the base route plus "express"', () => {
    expect(routeSpokenName('FX')).toBe('F express')
    expect(routeSpokenName('6X')).toBe('6 express')
  })
  it('leaves other names alone', () => {
    expect(routeSpokenName('A')).toBe('A')
    expect(routeSpokenName('SIR')).toBe('SIR')
  })
})

describe('scheduleLabel', () => {
  it('formats the YYYYMMDD prefix of the feed version', () => {
    expect(scheduleLabel('20261028-fall-2026-pick-with-long-term-supplements')).toBe('Schedule: Oct 28, 2026')
    expect(scheduleLabel('20270105')).toBe('Schedule: Jan 5, 2027')
  })

  it('falls back to the raw id when there is no valid date prefix', () => {
    expect(scheduleLabel('fall-2026')).toBe('Schedule: fall-2026')
    expect(scheduleLabel('20261328-x')).toBe('Schedule: 20261328-x')
  })
})
