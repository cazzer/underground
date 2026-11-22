import { describe, expect, it } from 'vitest'
import { index } from './fixture'
import { addDays, nyDate, serviceDayStart, servicesOn } from './serviceDate'

describe('serviceDayStart', () => {
  it('is New York midnight on an ordinary EST day', () => {
    expect(serviceDayStart('20261123')).toBe(Date.UTC(2026, 10, 23, 5) / 1000)
  })
  it('is New York midnight on an ordinary EDT day', () => {
    expect(serviceDayStart('20260701')).toBe(Date.UTC(2026, 6, 1, 4) / 1000)
  })
  it('is an hour off midnight on the fall-back day', () => {
    expect(serviceDayStart('20261101')).toBe(1793509200)
  })
  it('is an hour off midnight on the spring-forward day', () => {
    expect(serviceDayStart('20260308')).toBe(1772942400)
    expect(serviceDayStart('20270314')).toBe(Date.UTC(2027, 2, 14, 4) / 1000)
  })
})

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
