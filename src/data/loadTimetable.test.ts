import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { index } from '../lib/realtime/fixture'
import { expectServiceCalendar, expectTimetable } from './loadTimetable'

const URL = 'x/Sunday.json'
const sunday = JSON.parse(readFileSync('public/data/timetable/Sunday.json', 'utf8')) as Record<string, unknown>

const valid = {
  format: 1,
  feedVersion: 'v',
  services: ['Sunday'],
  changes: [],
  patterns: [{ routeId: 'L', direction: 'N', stops: ['L08N', 'L06N'], trips: [] }],
}
const withPattern = (patch: Record<string, unknown>) => ({ ...valid, patterns: [{ ...valid.patterns[0], ...patch }] })

describe('expectTimetable', () => {
  it('accepts the committed Sunday file for Sunday only', () => {
    expect(expectTimetable(sunday, URL, 'Sunday')).toBe(sunday)
    expect(() => expectTimetable(sunday, URL, 'Weekday')).toThrow(`${URL}: not a timetable file (holds Sunday, not Weekday)`)
  })

  it.each([
    ['null', null],
    ['format 2', { ...valid, format: 2 }],
    ['no feedVersion', { ...valid, feedVersion: undefined }],
    ['services not an array', { ...valid, services: 'Sunday' }],
    ['no changes', { ...valid, changes: undefined }],
    ['patterns not an array', { ...valid, patterns: {} }],
    ['a pattern with one stop', withPattern({ stops: ['L08N'] })],
    ['an unknown direction', withPattern({ direction: 'X' })],
    ['trips not an array', withPattern({ trips: {} })],
  ])('rejects %s, naming the url', (_why, raw) => {
    expect(() => expectTimetable(raw, URL, 'Sunday')).toThrow(new RegExp(`^${URL}: not a timetable file`))
  })
})

describe('expectServiceCalendar', () => {
  it('keeps the calendar and its exceptions', () => {
    expect(expectServiceCalendar(index, 'x/trip-index.json')).toEqual({
      calendar: index.calendar,
      calendarExceptions: index.calendarExceptions,
    })
  })

  it('rejects a file without calendarExceptions or calendar', () => {
    expect(() => expectServiceCalendar({ ...index, calendarExceptions: undefined }, 'x')).toThrow('x: not a calendar file')
    expect(() => expectServiceCalendar({ ...index, calendar: undefined }, 'x')).toThrow('x: not a calendar file')
  })
})
