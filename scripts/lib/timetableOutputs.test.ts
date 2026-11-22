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

/** Per stop pattern of one service: the sorted first departures in its timetable file, and the sorted unique trip-id
 *  origins (seconds) in trip-index.json, whose patterns are per shape. */
function departuresAndOrigins(service: string): Map<string, { departures: number[]; origins: number[] }> {
  const out = new Map<string, { departures: number[]; origins: number[] }>()
  const entry = (key: string) => out.get(key) ?? out.set(key, { departures: [], origins: [] }).get(key)!
  for (const p of files.get(service)!.patterns) entry(patternKey(p)).departures.push(...decodePatternTimes(p).map((t) => t.departures[0]!))
  for (const [shape, list] of Object.entries(tripIndex.origins[service] ?? {})) {
    entry(patternKey(tripIndex.patterns[shape]!)).origins.push(...deltaDecode(list).map((o) => o * 0.6))
  }
  for (const e of out.values()) {
    e.departures.sort((x, y) => x - y)
    e.origins.sort((x, y) => x - y)
  }
  return out
}

/** The distance from `value` to the nearest of the sorted `list`. */
function nearest(list: readonly number[], value: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return Math.min(...[list[lo - 1], list[lo]].filter((v): v is number => v !== undefined).map((v) => Math.abs(v - value)))
}

/** On this feed every pattern's trips pair one to one with its origins (sorted against sorted): the difference of each pair. */
function pairedOffsets(): number[] {
  const out: number[] = []
  for (const service of files.keys()) {
    for (const [key, { departures, origins }] of departuresAndOrigins(service)) {
      if (departures.length !== origins.length) throw new Error(`${service} ${key}: ${departures.length} trips, ${origins.length} origins`)
      departures.forEach((d, i) => out.push(d - origins[i]!))
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

  it('has every trip-index origin: its stop pattern, at least as many trips, and a departure within 300 s', () => {
    for (const service of files.keys()) {
      for (const [key, { departures, origins }] of departuresAndOrigins(service)) {
        if (origins.length === 0) continue // a pattern of trips the index skips (no shape)
        expect(departures.length, `${service} ${key} has no trips`).toBeGreaterThan(0)
        expect(departures.length, `${service} ${key}`).toBeGreaterThanOrEqual(origins.length)
        for (const origin of origins) expect(nearest(departures, origin), `${service} ${key} origin ${origin}`).toBeLessThanOrEqual(300)
      }
    }
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
    // Exact pairing: one trip per origin, none more than 300 s apart, 240 more than 30 s apart.
    const offsets = pairedOffsets()
    expect(offsets.every((o) => Math.abs(o) <= 300)).toBe(true)
    expect(offsets.filter((o) => Math.abs(o) > 30)).toHaveLength(240)
    expect([...files.values()].reduce((n, f) => n + f.patterns.length, 0)).toBe(383)
    expect([...files.values()].reduce((n, f) => n + f.patterns.reduce((m, p) => m + p.trips.length, 0), 0)).toBe(20310)
  })
})
