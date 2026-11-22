import { describe, expect, it } from 'vitest'
import type { TimetableFile } from '../../src/data/timetableSchema.ts'
import { D1, D2, GAP, regularFeed, supplementedFeed } from './datedFixture.ts'
import { DATED_MAX_DAYS, buildDatedTimetables, datedWindow } from './datedTimetable.ts'
import { buildStationChanges, buildTimetables } from './timetable.ts'
import type { GtfsFeed } from './gtfs.ts'

const KNOWN = new Set(regularFeed().stops.filter((s) => s.locationType === 0).map((s) => s.id))
const build = (feed: GtfsFeed = supplementedFeed()) => buildDatedTimetables(feed, buildStationChanges(regularFeed()), KNOWN)
const dated = (): Map<string, TimetableFile> => new Map(build().files.map((f) => [f.date, f.file]))
const patternKeys = (file: TimetableFile): string[] => file.patterns.map((p) => `${p.routeId}|${p.direction}|${p.stops}`)
const regularWeekday = (): TimetableFile => buildTimetables(regularFeed()).files.find((f) => f.serviceId === 'Weekday')!.file

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
  it('makes the manifest and one file per date, in the contract order', () => {
    const { index, files } = build()
    expect(index).toEqual({ format: 1, feedVersion: 'fixture-1', dates: [D1, GAP, D2] })
    expect(files.map((f) => f.date)).toEqual([D1, GAP, D2])
    for (const { date, file } of files) {
      expect(Object.keys(file)).toEqual(['format', 'feedVersion', 'date', 'services', 'changes', 'patterns'])
      expect(file.date).toBe(date)
      expect(file.changes).toEqual(buildStationChanges(regularFeed()))
    }
  })

  it("lists the day's active supplemented services", () => {
    const files = dated()
    expect(files.get(D1)!.services).toEqual(['Weekday_C1', 'X1'])
    expect(files.get(GAP)!.services).toEqual(['Weekday_C1', 'Weekday_C2'])
    expect(files.get(D2)!.services).toEqual(['Weekday_C1', 'Weekday_C2', 'X2'])
  })

  it("holds a date-only service's trip and lacks a removed chunk's, so it differs from the regular service file", () => {
    const d1 = dated().get(D1)!
    expect(patternKeys(d1)).toContain('W|S|B01S,B03S')
    expect(patternKeys(d1).some((k) => k.startsWith('GS|') || k.startsWith('SI|'))).toBe(false)
    expect(patternKeys(regularWeekday())).not.toContain('W|S|B01S,B03S')
    expect(patternKeys(regularWeekday()).some((k) => k.startsWith('GS|'))).toBe(true)
  })

  it("makes a day with no planned work the regular service file's patterns", () => {
    expect(dated().get(GAP)!.patterns).toEqual(regularWeekday().patterns)
  })

  it('writes no files when no service is date-only', () => {
    const built = build(regularFeed())
    expect(built.files).toEqual([])
    expect(built.index.dates).toEqual([])
  })

  it('throws, naming the stop and the dates, on a stop stations.json lacks', () => {
    const known = new Set(KNOWN)
    known.delete('B03S')
    expect(() => buildDatedTimetables(supplementedFeed(), [], known)).toThrow(/B03S \(20261123, 20261125\)/)
  })
})
