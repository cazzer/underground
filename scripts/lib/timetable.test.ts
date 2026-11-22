import { describe, expect, it } from 'vitest'
import { decodePatternTimes } from '../../src/data/timetableCodec.ts'
import type { TimetableFile, TimetablePattern } from '../../src/data/timetableSchema.ts'
import { fixtureFeed } from './fixture.ts'
import { groupByTrip, type GtfsFeed, type StopTimeRow } from './gtfs.ts'
import { buildStationChanges, buildTimetables } from './timetable.ts'

/** fixtureFeed() with every run snapped to a whole 30 s (the fixture has 100, 200 and 400 s runs), nothing else changed. */
function timetableFeed(): GtfsFeed {
  const feed = fixtureFeed()
  const rows: StopTimeRow[] = []
  for (const trip of groupByTrip(feed.stopTimes).values()) {
    let previousDeparture = 0
    trip.forEach((row, i) => {
      const dwell = row.departure - row.arrival
      const arrival = i === 0 ? row.arrival : previousDeparture + Math.round((row.arrival - trip[i - 1]!.departure) / 30) * 30
      rows.push({ ...row, arrival, departure: arrival + dwell })
      previousDeparture = arrival + dwell
    })
  }
  feed.stopTimes = rows
  return feed
}

const A_STOPS = ['A01S', 'A02S', 'A03S']

function build(feed: GtfsFeed) {
  const built = buildTimetables(feed)
  const byId = Object.fromEntries(built.files.map((f) => [f.serviceId, f.file]))
  return { ...built, byId }
}

/** route|direction|stops|arrivals|departures for every trip of a file. */
function decodedStrings(file: TimetableFile): string[] {
  return file.patterns
    .flatMap((p) => decodePatternTimes(p).map((t) => `${p.routeId}|${p.direction}|${p.stops}|${t.arrivals}|${t.departures}`))
    .sort()
}

function feedStrings(feed: GtfsFeed, service: string): string[] {
  const stopTimes = groupByTrip(feed.stopTimes)
  return feed.trips
    .filter((t) => t.serviceId === service && (stopTimes.get(t.id)?.length ?? 0) >= 2)
    .map((t) => {
      const rows = stopTimes.get(t.id)!
      return `${t.routeId}|${t.direction}|${rows.map((r) => r.stopId)}|${rows.map((r) => r.arrival)}|${rows.map((r) => r.departure)}`
    })
    .sort()
}

function patternFor(file: TimetableFile, route: string, stops: string[]): TimetablePattern[] {
  return file.patterns.filter((p) => p.routeId === route && p.stops.join() === stops.join())
}

describe('buildTimetables', () => {
  it('throws, naming the trip and stop, on a time that is not a multiple of 30 s', () => {
    expect(() => buildTimetables(fixtureFeed())).toThrow(/Trip \S+ at \S+: time \d+ s is not a multiple of 30 s/)
  })

  it('makes one file per service id, sorted, with the format, feed version and its service', () => {
    const { files } = build(timetableFeed())
    expect(files.map((f) => f.serviceId)).toEqual(['Saturday', 'Sunday', 'Weekday'])
    for (const { serviceId, file } of files) {
      expect(file.format).toBe(1)
      expect(file.feedVersion).toBe('fixture-1')
      expect(file.services).toEqual([serviceId])
      expect(Object.keys(file)).toEqual(['format', 'feedVersion', 'services', 'changes', 'patterns'])
    }
  })

  it('gives a calendar-only service a file with no patterns', () => {
    const feed = timetableFeed()
    feed.calendar.push({ serviceId: 'Holiday', days: [1], start: '20261101', end: '20270515' })
    feed.calendarDates.push({ serviceId: 'Extra_1', date: '20261127', exceptionType: 1 })
    const { byId } = build(feed)
    expect(byId['Holiday']!.patterns).toEqual([])
    expect(byId['Extra_1']!.patterns).toEqual([])
  })

  it('decodes to exactly the times in stop_times, per service, and counts the skipped trip', () => {
    const feed = timetableFeed()
    const { byId, skippedShort, splitPatterns } = build(feed)
    for (const service of Object.keys(byId)) expect(decodedStrings(byId[service]!)).toEqual(feedStrings(feed, service))
    const total = Object.values(byId).reduce((n, f) => n + f.patterns.reduce((m, p) => m + p.trips.length, 0), 0)
    expect(skippedShort).toBe(1) // P_009000_ has no stop_times
    expect(total).toBe(feed.trips.length - skippedShort)
    expect(splitPatterns).toBe(0)
  })

  it('stores the first trip absolute, then departure deltas, in 30 s units, sorted', () => {
    const [pattern] = patternFor(build(timetableFeed()).byId['Weekday']!, '1', A_STOPS)
    expect(pattern!.trips).toEqual([
      [12, [2, 2]], // 360 s, then 60 s runs
      [40, [3, 3]], // 1560 s is 1200 s later; 90 s runs
    ])
  })

  it('takes dep0 from the first departure, not from the trip id', () => {
    const feed = timetableFeed()
    for (const row of feed.stopTimes) {
      if (row.tripId === 'Weekday_000600_1..S03R') {
        row.arrival += 90
        row.departure += 90
      }
    }
    const [pattern] = patternFor(build(feed).byId['Weekday']!, '1', A_STOPS)
    expect(decodePatternTimes(pattern!)[0]!.departures[0]).toBe(450)
  })

  it('encodes dwell as flat index, unit pairs, at the first and the last stop too', () => {
    const [pattern] = patternFor(build(timetableFeed()).byId['Weekday']!, '1', ['A01S', 'A03S'])
    expect(pattern!.trips).toEqual([[21, [7], [0, 1, 1, 1]]]) // dwell 30 s at both ends of the fixture's 1..S04R
    const times = decodePatternTimes(pattern!)[0]!
    expect(times.arrivals[0]).toBe(600)
    expect(times.departures[0]).toBe(630)
    expect(times.arrivals[1]).toBe(840)
    expect(times.departures[1]).toBe(870)
  })

  it('keeps a trip with no dwell as a 2-tuple', () => {
    const { byId } = build(timetableFeed())
    for (const file of Object.values(byId)) {
      for (const trip of file.patterns.flatMap((p) => p.trips)) expect(trip.length).toBe(trip[2] === undefined ? 2 : 3)
    }
    expect(patternFor(byId['Sunday']!, '1', ['A01S', 'A03S'])[0]!.trips[0]).toEqual([20, [7]])
  })

  it('decodes a dwell at the first stop as an arrival before the departure', () => {
    const feed = timetableFeed()
    const first = feed.stopTimes.find((r) => r.tripId === 'Weekday_000600_1..S03R' && r.sequence === 1)!
    first.departure += 30
    const [pattern] = patternFor(build(feed).byId['Weekday']!, '1', A_STOPS)
    const times = decodePatternTimes(pattern!)[0]!
    expect(times.arrivals[0]).toBe(360)
    expect(times.departures[0]).toBe(390)
    expect(times.arrivals[1]).toBe(420)
  })

  it('keys patterns by stop sequence: another shape, or none, joins the same pattern', () => {
    const feed = timetableFeed()
    const rows = feed.stopTimes.filter((r) => r.tripId === 'Weekday_000600_1..S03R')
    feed.trips.push({ id: 'Weekday_000700_1..S05R', routeId: '1', serviceId: 'Weekday', direction: 'S', shapeId: '1..S05R' })
    feed.stopTimes.push(...rows.map((r) => ({ ...r, tripId: 'Weekday_000700_1..S05R', arrival: r.arrival + 60, departure: r.departure + 60 })))
    feed.stopTimes.push(...rows.map((r) => ({ ...r, tripId: 'P_009000_', arrival: r.arrival + 5400, departure: r.departure + 5400 })))
    const { byId, skippedShort } = build(feed)
    const patterns = patternFor(byId['Weekday']!, '1', A_STOPS)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.trips).toHaveLength(4)
    expect(skippedShort).toBe(0)
  })

  it('splits a pattern into non-overtaking lanes, kept next to each other', () => {
    const feed = timetableFeed()
    // Leaves A01S at 390 s (after the 360 s trip) but is at A03S at 450 s, before that trip's 480 s.
    feed.trips.push({ id: 'Weekday_000650_1..S03R', routeId: '1', serviceId: 'Weekday', direction: 'S', shapeId: '1..S03R' })
    A_STOPS.forEach((stopId, i) => {
      const t = 390 + 30 * i
      feed.stopTimes.push({ tripId: 'Weekday_000650_1..S03R', stopId, arrival: t, departure: t, sequence: i + 1 })
    })
    const { byId, splitPatterns } = build(feed)
    expect(splitPatterns).toBe(1)
    const file = byId['Weekday']!
    const lanes = patternFor(file, '1', A_STOPS)
    expect(lanes).toHaveLength(2)
    const start = file.patterns.indexOf(lanes[0]!)
    expect(file.patterns[start + 1]).toBe(lanes[1])
    for (const lane of lanes) {
      const times = decodePatternTimes(lane)
      for (let i = 1; i < times.length; i++) {
        times[i]!.arrivals.forEach((a, s) => expect(a).toBeGreaterThanOrEqual(times[i - 1]!.arrivals[s]!))
        times[i]!.departures.forEach((d, s) => expect(d).toBeGreaterThanOrEqual(times[i - 1]!.departures[s]!))
      }
    }
    expect(decodedStrings(file)).toEqual(feedStrings(feed, 'Weekday'))
  })

  it('orders patterns by route, direction and stops', () => {
    const keys = build(timetableFeed()).byId['Weekday']!.patterns.map((p) => `${p.routeId}|${p.direction}|${p.stops}`)
    expect(keys).toEqual(['1|S|A01S,A02S,A03S', '1|S|A01S,A03S', 'GS|N|G01N,A02N', 'SI|S|A01S,A02S'])
  })

  it('throws on a negative run, a parent station in stop_times, and a service id that is not a file name', () => {
    const negative = timetableFeed()
    negative.stopTimes.find((r) => r.tripId === 'Weekday_000600_1..S03R' && r.sequence === 2)!.arrival -= 90
    expect(() => buildTimetables(negative)).toThrow(/Weekday_000600_1..S03R at A02S: arrives before it left/)

    const parent = timetableFeed()
    parent.stopTimes.find((r) => r.tripId === 'Weekday_000600_1..S03R' && r.sequence === 2)!.stopId = 'A02'
    expect(() => buildTimetables(parent)).toThrow(/A02, which is not a child stop/)

    const unknown = timetableFeed()
    unknown.stopTimes.find((r) => r.tripId === 'Weekday_000600_1..S03R' && r.sequence === 2)!.stopId = 'Q99S'
    expect(() => buildTimetables(unknown)).toThrow(/unknown stop Q99S/)

    const slash = timetableFeed()
    slash.calendar.push({ serviceId: 'a/b', days: [1], start: '20261101', end: '20270515' })
    expect(() => buildTimetables(slash)).toThrow(/Service id "a\/b" cannot be a file name/)
  })
})

describe('buildStationChanges', () => {
  it('keeps only the same-station rows, as {station, minTransferSec}', () => {
    expect(buildStationChanges(fixtureFeed())).toEqual([{ station: 'A01', minTransferSec: 180 }])
  })

  it('puts the same list in every file', () => {
    for (const { file } of build(timetableFeed()).files) expect(file.changes).toEqual([{ station: 'A01', minTransferSec: 180 }])
  })

  it('sorts by station and throws on a duplicate, a child stop, or a blank time', () => {
    const feed = fixtureFeed()
    feed.transfers.push({ from: 'B01', to: 'B01', minTransferTime: '0' })
    feed.transfers.push({ from: 'A03', to: 'A03', minTransferTime: '300' })
    expect(buildStationChanges(feed).map((c) => c.station)).toEqual(['A01', 'A03', 'B01'])

    const dup = fixtureFeed()
    dup.transfers.push({ from: 'A01', to: 'A01', minTransferTime: '60' })
    expect(() => buildStationChanges(dup)).toThrow(/A01 has more than one same-station transfer/)

    const child = fixtureFeed()
    child.transfers.push({ from: 'A01S', to: 'A01S', minTransferTime: '60' })
    expect(() => buildStationChanges(child)).toThrow(/A01S, which is not a parent station/)

    const blank = fixtureFeed()
    blank.transfers.push({ from: 'B02', to: 'B02', minTransferTime: ' ' })
    expect(() => buildStationChanges(blank)).toThrow(/Expected a number for min_transfer_time B02>B02/)
  })
})
