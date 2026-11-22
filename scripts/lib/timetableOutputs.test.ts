/**
 * The committed timetable files (public/data/timetable/) against the other committed data: one file per service,
 * each under its cap, every stop real, no trip overtaking another, and the same runs, trips and station changes the
 * rest of the data has. Rerun `npm run data` when it fails.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { deltaDecode, segmentKey } from '../../src/data/codec.ts'
import type { SegmentsFile, StationsFile, TripIndexFile } from '../../src/data/schema.ts'
import { decodePatternTimes } from '../../src/data/timetableCodec.ts'
import { TIMETABLE_FORMAT, type TimetableFile } from '../../src/data/timetableSchema.ts'
import { TIMETABLE_FILE_GZIP_CAP_BYTES } from './budget.ts'
import { compareIds } from './gtfs.ts'
import { median } from './segments.ts'

/** The feed the counts below were measured on; they are asserted only while the files come from it. */
const MEASURED_FEED = '20261028-fall-2026-pick-with-long-term-supplements'

const DATA = new URL('../../public/data/', import.meta.url)
const DIR = new URL('timetable/', DATA)
const json = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))

const stations = (json(new URL('stations.json', DATA)) as StationsFile).stations
const tripIndex = json(new URL('trip-index.json', DATA)) as TripIndexFile
const segments = (json(new URL('segments.json', DATA)) as SegmentsFile).segments
const names = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
const files = new Map(names.map((name) => [name.replace(/\.json$/, ''), json(new URL(name, DIR)) as TimetableFile]))
const services = [...new Set([...Object.keys(tripIndex.calendar), ...tripIndex.calendarExceptions.map((e) => e.serviceId)])].sort(compareIds)

const patternKey = (p: { routeId: string; direction: string; stops: string[] }): string => `${p.routeId}|${p.direction}|${p.stops}`

/** Per service and stop pattern, the sorted first departures paired with the sorted trip-id origins (seconds): the
 *  difference of each pair. Throws when the counts differ. */
function pairedOffsets(): { label: string; offset: number }[] {
  const out: { label: string; offset: number }[] = []
  for (const [service, file] of files) {
    const departures = new Map<string, number[]>()
    for (const p of file.patterns) {
      const list = departures.get(patternKey(p)) ?? []
      list.push(...decodePatternTimes(p).map((t) => t.departures[0]!))
      departures.set(patternKey(p), list)
    }
    const origins = new Map<string, number[]>()
    for (const [shape, list] of Object.entries(tripIndex.origins[service] ?? {})) {
      const key = patternKey(tripIndex.patterns[shape]!)
      origins.set(key, [...(origins.get(key) ?? []), ...deltaDecode(list).map((o) => o * 0.6)])
    }
    const keys = [...departures.keys()].sort(compareIds)
    if (keys.join(';') !== [...origins.keys()].sort(compareIds).join(';')) throw new Error(`${service}: stop patterns differ from trip-index.json`)
    for (const key of keys) {
      const deps = departures.get(key)!.sort((a, b) => a - b)
      const orig = origins.get(key)!.sort((a, b) => a - b)
      if (deps.length !== orig.length) throw new Error(`${service} ${key}: ${deps.length} trips, ${orig.length} origins`)
      deps.forEach((d, i) => out.push({ label: `${service} ${key}`, offset: d - orig[i]! }))
    }
  }
  return out
}

describe('public/data/timetable', () => {
  it('has one file per service in the trip index calendar, and no others', () => {
    expect(names).toEqual(services.map((s) => `${s}.json`))
  })

  it('keeps each file under its gzip cap, in format 1, for its own service and the data feed', () => {
    for (const [service, file] of files) {
      expect(gzipSync(readFileSync(new URL(`${service}.json`, DIR)), { level: 9 }).length).toBeLessThanOrEqual(TIMETABLE_FILE_GZIP_CAP_BYTES)
      expect(file.format).toBe(TIMETABLE_FORMAT)
      expect(file.services).toEqual([service])
      expect(file.feedVersion).toBe(tripIndex.feedVersion)
    }
  })

  it('calls only at stations stops, at least two per pattern, with well-formed runs and dwell', () => {
    const stops = new Set(stations.flatMap((s) => s.stops))
    for (const file of files.values()) {
      for (const p of file.patterns) {
        expect(p.stops.length).toBeGreaterThanOrEqual(2)
        for (const stop of p.stops) expect(stops.has(stop), stop).toBe(true)
        decodePatternTimes(p) // throws on a bad runs length or dwell
        for (const [dep, runs, dwell = []] of p.trips) {
          expect(dep).toBeGreaterThanOrEqual(0)
          expect(runs.every((r) => Number.isInteger(r) && r >= 0)).toBe(true)
          expect(dwell.filter((_, k) => k % 2 === 1).every((d) => Number.isInteger(d) && d > 0)).toBe(true)
        }
      }
    }
  })

  it('never lets a trip overtake the one before it in a pattern', () => {
    for (const file of files.values()) {
      for (const p of file.patterns) {
        const times = decodePatternTimes(p)
        for (let i = 1; i < times.length; i++) {
          const ok = times[i]!.arrivals.every((a, s) => a >= times[i - 1]!.arrivals[s]!) && times[i]!.departures.every((d, s) => d >= times[i - 1]!.departures[s]!)
          if (!ok) throw new Error(`${patternKey(p)} trip ${i} overtakes trip ${i - 1}`)
        }
      }
    }
  })

  it('reproduces segments.json: the rounded median of every run over all files', () => {
    const samples = new Map<string, number[]>()
    for (const file of files.values()) {
      for (const p of file.patterns) {
        for (const t of decodePatternTimes(p)) {
          for (let i = 1; i < p.stops.length; i++) {
            const run = t.arrivals[i]! - t.departures[i - 1]!
            if (run <= 0) continue
            const key = segmentKey(p.stops[i - 1]!, p.stops[i]!)
            samples.set(key, [...(samples.get(key) ?? []), run])
          }
        }
      }
    }
    expect(Object.fromEntries([...samples].map(([key, list]) => [key, Math.round(median(list))]))).toEqual(segments)
  })

  it('has the trip index trips: the same count per service and stop pattern, first departures near the origins', () => {
    expect(pairedOffsets().length).toBeGreaterThan(0)
    for (const { label, offset } of pairedOffsets()) expect(Math.abs(offset), label).toBeLessThanOrEqual(300)
  })

  it('carries the same sorted, unique station changes in every file, all at stations', () => {
    const ids = new Set(stations.map((s) => s.id))
    const [first] = [...files.values()]
    const stationsOf = first!.changes.map((c) => c.station)
    expect(stationsOf).toEqual([...new Set(stationsOf)].sort(compareIds))
    for (const station of stationsOf) expect(ids.has(station), station).toBe(true)
    for (const file of files.values()) expect(file.changes).toEqual(first!.changes)
  })

  it.runIf(tripIndex.feedVersion === MEASURED_FEED)('matches the counts measured on the fall 2026 feed', () => {
    const histogram: Record<number, number> = {}
    for (const c of [...files.values()][0]!.changes) histogram[c.minTransferSec] = (histogram[c.minTransferSec] ?? 0) + 1
    expect(histogram).toEqual({ 0: 57, 180: 400, 300: 6 })
    expect(pairedOffsets().filter((o) => Math.abs(o.offset) > 30)).toHaveLength(240)
    expect([...files.values()].reduce((n, f) => n + f.patterns.length, 0)).toBe(383)
    expect([...files.values()].reduce((n, f) => n + f.patterns.reduce((m, p) => m + p.trips.length, 0), 0)).toBe(20310)
  })
})
