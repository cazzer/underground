import { describe, expect, it } from 'vitest'
import type { TimetableFile } from '../../src/data/timetableSchema.ts'
import { D1, D2, GAP, HOLIDAY, REMOVAL, regularFeed, supplementedFeed } from './datedFixture.ts'
import { DATED_MAX_DAYS, buildDatedTimetables, datedWindow, serviceDays } from './datedTimetable.ts'
import { buildStationChanges } from './timetable.ts'
import type { GtfsFeed } from './gtfs.ts'

const KNOWN = new Set(regularFeed().stops.filter((s) => s.locationType === 0).map((s) => s.id))
const REGULAR = serviceDays(regularFeed())
const build = (feed: GtfsFeed = supplementedFeed()) => buildDatedTimetables(feed, REGULAR, buildStationChanges(regularFeed()), KNOWN)
const dated = (): Map<string, TimetableFile> => new Map(build().files.map((f) => [f.date, f.file]))
const patternKeys = (file: TimetableFile): string[] => file.patterns.map((p) => `${p.routeId}|${p.direction}|${p.stops}`)
const isShuttle = (k: string): boolean => k.startsWith('GS|') || k.startsWith('SI|')

describe('datedWindow', () => {
  it('runs from the first to the last date-only service day, a gap day included', () => {
    expect(datedWindow(supplementedFeed())).toEqual([D1, GAP, D2])
  })

  it('is empty when no service is date-only (an exception for a calendar service does not count)', () => {
    expect(datedWindow(regularFeed())).toEqual([])
  })

  it('throws above the day limit, naming the span', () => {
    const feed = supplementedFeed()
    feed.calendarDates.push({ serviceId: 'X3', date: '20261208', exceptionType: 1 })
    expect(DATED_MAX_DAYS).toBe(14)
    expect(() => datedWindow(feed)).toThrow(/20261123 to 20261208: more than 14 days/)
  })

  it('accepts exactly the limit', () => {
    const feed = supplementedFeed()
    feed.calendarDates.push({ serviceId: 'X3', date: '20261206', exceptionType: 1 })
    expect(datedWindow(feed)).toHaveLength(14)
  })
})

describe('buildDatedTimetables', () => {
  it('makes the manifest and one file per changed date, not contiguous, in the contract order', () => {
    const { index, files } = build()
    expect(index).toEqual({ format: 1, feedVersion: 'fixture-1', dates: [D1, D2, REMOVAL] })
    expect(files.map((f) => f.date)).toEqual([D1, D2, REMOVAL])
    for (const { date, file } of files) {
      expect(Object.keys(file)).toEqual(['format', 'feedVersion', 'date', 'services', 'changes', 'patterns'])
      expect(file.date).toBe(date)
      expect(file.changes).toEqual(buildStationChanges(regularFeed()))
    }
  })

  it("lists the day's active supplemented services", () => {
    const files = dated()
    expect(files.get(D1)!.services).toEqual(['Weekday_C1', 'X1'])
    expect(files.get(D2)!.services).toEqual(['Weekday_C1', 'Weekday_C2', 'X2'])
    expect(files.get(REMOVAL)!.services).toEqual(['Weekday_C1'])
  })

  it("holds a date-only service's trip and lacks a removed chunk's", () => {
    const d1 = dated().get(D1)!
    expect(patternKeys(d1)).toContain('W|S|B01S,B03S')
    expect(patternKeys(d1).some(isShuttle)).toBe(false)
  })

  it('dates a day outside the add-window where planned work only removes trains', () => {
    const removal = dated().get(REMOVAL)!
    expect(patternKeys(removal).some(isShuttle)).toBe(false)
    expect(patternKeys(removal)).toContain('1|S|A01S,A02S,A03S')
  })

  it('gives no file to a day nothing changes on: a gap day in the window, or a holiday both feeds share', () => {
    const { dates } = build().index
    expect(dates).not.toContain(GAP)
    expect(dates).not.toContain(HOLIDAY)
    expect(dates).not.toContain('20261120')
  })

  it('writes no files when the two feeds run the same trips', () => {
    const built = build(regularFeed())
    expect(built.files).toEqual([])
    expect(built.index.dates).toEqual([])
  })

  it('throws, naming the dates, above the dated-set limit', () => {
    const feed = supplementedFeed()
    const weekdays = ['20261207', '20261208', '20261209', '20261210', '20261211', '20261214', '20261215', '20261216', '20261217', '20261218', '20261221', '20261222']
    for (const date of weekdays) feed.calendarDates.push({ serviceId: 'Weekday_C2', date, exceptionType: 2 })
    expect(() => build(feed)).toThrow('Planned work changes 15 dates (20261123, 20261125, 20261201, 20261207,')
  })

  it('throws on a date that could not be a file name', () => {
    for (const bad of ['20261121/../../evil', '2026112', '20261332', 'abcdefgh']) {
      const feed = supplementedFeed()
      feed.calendarDates.push({ serviceId: 'Weekday_C2', date: bad, exceptionType: 2 })
      expect(() => build(feed), bad).toThrow(/is not a YYYYMMDD date/)
    }
  })

  it('throws, naming the stop and the dates, on a stop stations.json lacks', () => {
    const known = new Set(KNOWN)
    known.delete('B03S')
    expect(() => buildDatedTimetables(supplementedFeed(), REGULAR, [], known)).toThrow(/B03S \(20261123, 20261125\)/)
  })
})
