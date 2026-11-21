import { describe, expect, it } from 'vitest'
import { index } from './fixture'
import { addDays, nyDate, servicesOn } from './serviceDate'

const on = (date: string) => servicesOn(date, index.calendar, index.calendarExceptions)

describe('servicesOn', () => {
  it('picks the service by weekday', () => {
    expect(on('20261120')).toEqual(['Weekday'])
    expect(on('20261121')).toEqual(['Saturday'])
    expect(on('20261122')).toEqual(['Sunday'])
  })
  it('applies exceptions (holiday swap)', () => {
    expect(on('20261126')).toEqual(['Sunday'])
  })
  it('returns nothing outside the calendar range', () => {
    expect(on('20270601')).toEqual([])
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries both ways', () => {
    expect(addDays('20261231', 1)).toBe('20270101')
    expect(addDays('20261201', -1)).toBe('20261130')
    expect(addDays('20260228', 1)).toBe('20260301')
  })
})

describe('nyDate', () => {
  it('uses the New York calendar date across the EST midnight boundary', () => {
    expect(nyDate(Date.UTC(2026, 10, 21, 4, 59, 59) / 1000)).toBe('20261120')
    expect(nyDate(Date.UTC(2026, 10, 21, 5, 0, 0) / 1000)).toBe('20261121')
  })
  it('uses the New York calendar date across the EDT midnight boundary', () => {
    expect(nyDate(Date.UTC(2026, 6, 1, 3, 59, 59) / 1000)).toBe('20260630')
    expect(nyDate(Date.UTC(2026, 6, 1, 4, 0, 0) / 1000)).toBe('20260701')
  })
  it('reads a recorded feed timestamp', () => {
    expect(nyDate(1795228554)).toBe('20261120')
  })
})
