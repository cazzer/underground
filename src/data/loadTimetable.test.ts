import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { index } from '../lib/realtime/fixture'
import { expectDatedIndex, expectServiceCalendar, expectTimetable } from './loadTimetable'

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
    expect(expectTimetable(sunday, URL, { service: 'Sunday' })).toBe(sunday)
    expect(() => expectTimetable(sunday, URL, { service: 'Weekday' })).toThrow(`${URL}: not a timetable file (holds Sunday, not Weekday)`)
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
    expect(() => expectTimetable(raw, URL, { service: 'Sunday' })).toThrow(new RegExp(`^${URL}: not a timetable file`))
  })
})

describe('expectTimetable for a dated file', () => {
  const datedFile = { ...valid, date: '20261123', services: ['Weekday_C1', 'X1'] }

  it('accepts a file dated as asked, whatever services it lists', () => {
    expect(expectTimetable(datedFile, URL, { date: '20261123' })).toBe(datedFile)
  })

  it('rejects a file for another date, or with none', () => {
    expect(() => expectTimetable(datedFile, URL, { date: '20261124' })).toThrow(`${URL}: not a timetable file (dated 20261123, not 20261124)`)
    expect(() => expectTimetable(valid, URL, { date: '20261123' })).toThrow('dated undefined, not 20261123')
  })
})

describe('expectDatedIndex', () => {
  const ok = { format: 1, feedVersion: 'v', dates: ['20261121', '20261122'] }

  it('accepts sorted unique YYYYMMDD dates, or none', () => {
    expect(expectDatedIndex(ok, 'x')).toBe(ok)
    expect(expectDatedIndex({ ...ok, dates: [] }, 'x').dates).toEqual([])
  })

  it.each([
    ['null', null],
    ['format 2', { ...ok, format: 2 }],
    ['no feedVersion', { ...ok, feedVersion: 1 }],
    ['dates not an array', { ...ok, dates: '20261121' }],
    ['a date that is not YYYYMMDD', { ...ok, dates: ['2026-11-21'] }],
    ['a number date', { ...ok, dates: [20261121] }],
    ['unsorted dates', { ...ok, dates: ['20261122', '20261121'] }],
    ['a repeated date', { ...ok, dates: ['20261121', '20261121'] }],
  ])('rejects %s, naming the url', (_why, raw) => {
    expect(() => expectDatedIndex(raw, 'x/index.json')).toThrow(/^x\/index.json: not a dated timetable index/)
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
