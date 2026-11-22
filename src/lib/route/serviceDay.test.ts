import { describe, expect, it } from 'vitest'
import type { CalendarException } from '../../data/schema'
import { index } from '../realtime/fixture'
import { serviceWindow, windowKey } from './serviceDay'

const at = (...utc: [number, number, number, number, number?]) => Date.UTC(utc[0], utc[1], utc[2], utc[3], utc[4] ?? 0) / 1000
const win = (atS: number, exceptions: readonly CalendarException[] = index.calendarExceptions) =>
  serviceWindow(atS, index.calendar, exceptions)

describe('serviceWindow', () => {
  it('picks one frame in mid-day', () => {
    const w = win(at(2026, 10, 23, 13)) // Mon 08:00 EST
    expect(w.date).toBe('20261123')
    expect(w.startS).toBe(at(2026, 10, 23, 5))
    expect(w.frames).toEqual([{ date: '20261123', services: ['Weekday'], shiftS: 0, dated: false }])
  })

  it('picks Saturday and Sunday', () => {
    expect(win(at(2026, 10, 28, 17)).frames.map((f) => f.services)).toEqual([['Saturday']])
    expect(win(at(2026, 10, 29, 17)).frames.map((f) => f.services)).toEqual([['Sunday']])
  })

  it('applies a holiday exception (Thanksgiving runs Sunday service)', () => {
    expect(win(at(2026, 10, 26, 17)).frames.map((f) => f.services)).toEqual([['Sunday']])
  })

  it('applies an exception that swaps a weekday for Saturday', () => {
    const extra: CalendarException[] = [
      ...index.calendarExceptions,
      { date: '20270118', serviceId: 'Saturday', exceptionType: 1 },
      { date: '20270118', serviceId: 'Weekday', exceptionType: 2 },
    ]
    expect(win(at(2027, 0, 18, 17), extra).frames.map((f) => f.services)).toEqual([['Saturday']])
  })

  it('adds yesterday before 04:00, shifted back a day', () => {
    expect(win(at(2026, 10, 27, 7)).frames).toEqual([
      { date: '20261126', services: ['Sunday'], shiftS: -86400, dated: false },
      { date: '20261127', services: ['Weekday'], shiftS: 0, dated: false },
    ]) // Fri 02:00 EST, after Thanksgiving
    expect(win(at(2026, 10, 23, 6, 30)).frames.map((f) => [f.date, f.services])).toEqual([
      ['20261122', ['Sunday']],
      ['20261123', ['Weekday']],
    ])
  })

  it('drops yesterday from 04:00', () => {
    expect(win(at(2026, 10, 23, 9, 30)).frames.map((f) => f.date)).toEqual(['20261123'])
  })

  it('adds tomorrow from 22:00, shifted forward a day', () => {
    expect(win(at(2026, 10, 26, 4)).frames).toEqual([
      { date: '20261125', services: ['Weekday'], shiftS: 0, dated: false },
      { date: '20261126', services: ['Sunday'], shiftS: 86400, dated: false },
    ]) // Wed 23:00 EST
  })

  it('shifts by the real length of the day across the spring DST change', () => {
    const w = win(at(2027, 2, 14, 6)) // Sun 01:00 EST, the hour before the clocks move
    expect(w.frames[0]).toMatchObject({ date: '20270313', shiftS: -82800 })
  })

  it('shifts by 25 h on the fall-back day, where q is negative before the day starts', () => {
    const calendar = {
      Saturday: { days: [6], start: '20261001', end: '20270515' },
      Sunday: { days: [0], start: '20261001', end: '20270515' },
    }
    const w = serviceWindow(at(2026, 10, 1, 4, 30), calendar, []) // Sun 00:30 EDT; the day starts at 01:00 EDT
    expect(w.startS).toBe(at(2026, 10, 1, 5))
    expect(w.frames).toEqual([
      { date: '20261031', services: ['Saturday'], shiftS: -90000, dated: false },
      { date: '20261101', services: ['Sunday'], shiftS: 0, dated: false },
    ])
  })

  it('has no frames past the calendar', () => {
    expect(win(at(2027, 5, 1, 16)).frames).toEqual([])
  })
})

describe('serviceWindow with dated files', () => {
  const MON = at(2026, 10, 23, 13) // Mon 08:00 EST

  it('marks the frames whose date has a dated file', () => {
    const w = serviceWindow(MON, index.calendar, index.calendarExceptions, new Set(['20261123']))
    expect(w.frames).toEqual([{ date: '20261123', services: ['Weekday'], shiftS: 0, dated: true }])
  })

  it('keeps a frame for a date only a dated file covers', () => {
    expect(win(at(2027, 5, 1, 16)).frames).toEqual([])
    const w = serviceWindow(at(2027, 5, 1, 16), index.calendar, index.calendarExceptions, new Set(['20270601']))
    expect(w.frames).toEqual([{ date: '20270601', services: [], shiftS: 0, dated: true }])
  })

  it('mixes sources across yesterday and tomorrow', () => {
    const early = serviceWindow(at(2026, 10, 23, 6, 30), index.calendar, index.calendarExceptions, new Set(['20261123']))
    expect(early.frames.map((f) => [f.date, f.dated])).toEqual([['20261122', false], ['20261123', true]])
    const late = serviceWindow(at(2026, 10, 23, 4), index.calendar, index.calendarExceptions, new Set(['20261123']))
    expect(late.frames.map((f) => [f.date, f.dated])).toEqual([['20261122', false], ['20261123', true]])
    const night = serviceWindow(at(2026, 10, 24, 4), index.calendar, index.calendarExceptions, new Set(['20261124']))
    expect(night.frames.map((f) => [f.date, f.dated])).toEqual([['20261123', false], ['20261124', true]])
  })
})

describe('windowKey', () => {
  it('differs for a dated frame and the same day undated', () => {
    const atMon = at(2026, 10, 23, 13)
    const plain = serviceWindow(atMon, index.calendar, index.calendarExceptions)
    const dated = serviceWindow(atMon, index.calendar, index.calendarExceptions, new Set(['20261123']))
    expect(windowKey(plain)).not.toBe(windowKey(dated))
    expect(windowKey(dated)).toContain('20261123:dated')
  })

  it('is equal for the same date and services, and differs when either changes', () => {
    const a = win(at(2026, 10, 23, 13))
    expect(windowKey(a)).toBe(windowKey(win(at(2026, 10, 23, 15))))
    expect(windowKey(a)).not.toBe(windowKey(win(at(2026, 10, 23, 6))))
    expect(windowKey(a)).not.toBe(windowKey(win(at(2026, 10, 24, 15))))
  })
})
