/**
 * The committed dated timetables (public/data/timetable/dated/) against the other committed data: the manifest and its
 * files agree, each file is under its cap, every stop is real, no trip overtakes another, and the station changes are
 * the service files'. Whatever dates the last refresh wrote are fine; the counts are asserted only while it is the one
 * measured. Rerun `npm run data` when it fails. (Each file through the router: src/data/datedTimetable.data.test.ts.)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../src/data/schema.ts'
import { decodePatternTimes } from '../../src/data/timetableCodec.ts'
import { TIMETABLE_FORMAT, type DatedTimetableIndex, type TimetableFile } from '../../src/data/timetableSchema.ts'
import { TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES, TIMETABLE_FILE_GZIP_CAP_BYTES } from './budget.ts'
import { DATED_MAX_DAYS } from './datedTimetable.ts'
import { addDays } from '../../src/lib/realtime/serviceDate.ts'

const DATA = new URL('../../public/data/', import.meta.url)
const DIR = new URL('timetable/dated/', DATA)
const json = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))

const stations = (json(new URL('stations.json', DATA)) as StationsFile).stations
const index = json(new URL('index.json', DIR)) as DatedTimetableIndex
const weekday = json(new URL('timetable/Weekday.json', DATA)) as TimetableFile
const names = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
const files = new Map(index.dates.map((date) => [date, json(new URL(`${date}.json`, DIR)) as TimetableFile]))

const tripCount = (file: TimetableFile): number => file.patterns.reduce((n, p) => n + p.trips.length, 0)

describe('public/data/timetable/dated', () => {
  it('holds index.json and exactly one file per date it lists', () => {
    expect(names).toEqual(['index.json', ...index.dates.map((d) => `${d}.json`)].sort())
    expect(index.format).toBe(TIMETABLE_FORMAT)
  })

  it('lists sorted, unique, real dates (not necessarily contiguous), at most the limit', () => {
    expect(index.dates.length).toBeLessThanOrEqual(DATED_MAX_DAYS)
    expect(index.dates).toEqual([...new Set(index.dates)].sort())
    for (const date of index.dates) {
      expect(date).toMatch(/^\d{8}$/)
      expect(addDays(date, 0), date).toBe(date)
    }
  })

  it('keeps each file and the directory under their gzip caps', () => {
    let total = 0
    for (const date of index.dates) {
      const gzip = gzipSync(readFileSync(new URL(`${date}.json`, DIR)), { level: 9 }).length
      expect(gzip, date).toBeLessThanOrEqual(TIMETABLE_FILE_GZIP_CAP_BYTES)
      total += gzip
    }
    expect(total).toBeLessThanOrEqual(TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES)
  })

  it("is in format 1, dated as its name, with the index's feed version and some active service", () => {
    for (const [date, file] of files) {
      expect(file.format, date).toBe(TIMETABLE_FORMAT)
      expect(file.date, date).toBe(date)
      expect(file.services.length, date).toBeGreaterThan(0)
      expect(file.feedVersion, date).toBe(index.feedVersion)
      expect(Object.keys(file), date).toEqual(['format', 'feedVersion', 'date', 'services', 'changes', 'patterns'])
    }
  })

  it('carries the service files\' station changes', () => {
    for (const [date, file] of files) expect(file.changes, date).toEqual(weekday.changes)
  })

  it('calls only at stations stops, at least two per pattern, and never lets a trip overtake the one before it', () => {
    const stops = new Set(stations.flatMap((s) => s.stops))
    for (const [date, file] of files) {
      for (const p of file.patterns) {
        const key = `${date} ${p.routeId}|${p.direction}|${p.stops}`
        expect(p.stops.length, key).toBeGreaterThanOrEqual(2)
        for (const stop of p.stops) expect(stops.has(stop), `${key} ${stop}`).toBe(true)
        const times = decodePatternTimes(p) // throws on a bad runs length or dwell
        for (let i = 1; i < times.length; i++) {
          const ok = times[i]!.arrivals.every((a, s) => a >= times[i - 1]!.arrivals[s]!) && times[i]!.departures.every((d, s) => d >= times[i - 1]!.departures[s]!)
          if (!ok) throw new Error(`${key} trip ${i} overtakes trip ${i - 1}`)
        }
      }
    }
  })

  // The window moves every day: this runs only while the files are the nine days measured on 2026-11-22.
  it.runIf(index.dates[0] === '20261121' && index.dates[index.dates.length - 1] === '20261129')('matches the counts measured on 20261121..20261129', () => {
    expect(index.dates).toHaveLength(9)
    const routeTrips = (file: TimetableFile, route: string): number =>
      file.patterns.filter((p) => p.routeId === route).reduce((n, p) => n + p.trips.length, 0)
    const saturday = json(new URL('timetable/Saturday.json', DATA)) as TimetableFile
    expect(tripCount(files.get('20261123')!)).toBe(8573)
    // Planned work: fewer 1 trains than the regular Saturday's 372, and the M nearly gone (274 regularly).
    expect(routeTrips(files.get('20261121')!, '1')).toBe(310)
    expect(routeTrips(saturday, '1')).toBe(372)
    expect(routeTrips(files.get('20261128')!, 'M')).toBe(23)
    expect(routeTrips(saturday, 'M')).toBe(274)
  })
})
