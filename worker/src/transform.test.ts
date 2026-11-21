import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeFeed } from './decode'
import type { transit_realtime } from './gen/subway-rt.js'
import {
  ARRIVALS_MIN,
  FEED_IDS,
  RT_SCHEMA_VERSION,
  type FeedId,
  type RealtimeSnapshot,
  type RealtimeTrip,
} from './schema'
import { buildSnapshot, compactArrivals, compactFeed, parseDirection, toSeconds, type FeedOutcome } from './transform'

type Message = transit_realtime.FeedMessage.$Properties
type StopTimeUpdate = transit_realtime.TripUpdate.StopTimeUpdate.$Properties

const SI_HEADER = 1795228558
const L_HEADER = 1795228557

function load(name: string): Message {
  return decodeFeed(new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))))
}

const emptyMessage = (timestamp: number): Message => ({ header: { timestamp }, entity: [] })

function outcomes(overrides: Partial<Record<FeedId, FeedOutcome>> = {}, base = emptyMessage(L_HEADER)) {
  return Object.fromEntries(FEED_IDS.map((id) => [id, overrides[id] ?? { ok: true, message: base }])) as Record<
    FeedId,
    FeedOutcome
  >
}

function realSnapshot(): RealtimeSnapshot {
  return buildSnapshot(
    outcomes({ l: { ok: true, message: load('feed-l.pb') }, si: { ok: true, message: load('feed-si.pb') } }),
    L_HEADER + 15,
  )
}

const tripById = (trips: RealtimeTrip[], id: string) => trips.find((t) => t.tripId === id)

const stu = (stopId: string | undefined, time: number | undefined): StopTimeUpdate => ({
  stopId,
  arrival: time === undefined ? null : { time },
})

describe('SI fixture', () => {
  const si = buildSnapshot(outcomes({ si: { ok: true, message: load('feed-si.pb') } }), SI_HEADER + 15).feeds.si

  it('decodes a full trip exactly (proves subset proto field numbers)', () => {
    expect(tripById(si.trips, '126600_SI.S03R')).toEqual({
      route: 'SI',
      direction: 'S',
      tripId: '126600_SI.S03R',
      trainId: '1SI 2106 STG/TNV',
      assigned: true,
      stopId: 'S18S',
      status: 'STOPPED_AT',
      timestamp: 1795228510,
      arrivals: [
        ['S17S', 1795228609],
        ['S16S', 1795228729],
        ['S15S', 1795228849],
        ['S14S', 1795228969],
        ['S13S', 1795229089],
        ['S11S', 1795229209],
        ['S09S', 1795229389],
      ],
    })
  })

  it('reads unset direction from the trip_id and unset status as IN_TRANSIT_TO', () => {
    const trip = tripById(si.trips, '132100_SI.N03R')
    expect(trip?.direction).toBe('N')
    expect(trip?.status).toBe('IN_TRANSIT_TO')
    expect(trip?.stopId).toBe('S09N')
  })
})

describe('L fixture', () => {
  const l = realSnapshot().feeds.l

  it('has the recorded header and trip count', () => {
    expect(l.headerTimestamp).toBe(L_HEADER)
    expect(l.trips).toHaveLength(29)
    expect(l.error).toBeNull()
    expect(l.stale).toBe(false)
  })

  it('keeps a trip with no VehiclePosition, using its first arrival as the stop', () => {
    const trip = tripById(l.trips, '130650_L..S')
    expect(trip?.status).toBeNull()
    expect(trip?.timestamp).toBeNull()
    expect(trip?.assigned).toBe(false)
    expect(trip?.stopId).toBe('L01S')
    expect(trip?.arrivals[0]).toEqual(['L01S', 1795229190])
  })
})

describe('integer safety', () => {
  it('emits plain integers, never Long objects', () => {
    const parsed = JSON.parse(JSON.stringify(realSnapshot())) as RealtimeSnapshot
    const times: unknown[] = []
    for (const feed of Object.values(parsed.feeds)) {
      times.push(feed.headerTimestamp ?? 0)
      for (const trip of feed.trips) {
        times.push(trip.timestamp ?? 0, ...trip.arrivals.map(([, t]) => t))
      }
    }
    expect(times.length).toBeGreaterThan(100)
    expect(times.every((t) => Number.isInteger(t))).toBe(true)
  })

  it('toSeconds converts numbers and Long-likes, and maps 0 and missing to null', () => {
    expect(toSeconds(1795228557)).toBe(1795228557)
    expect(toSeconds({ toNumber: () => 5 })).toBe(5)
    expect(toSeconds(null)).toBeNull()
    expect(toSeconds(undefined)).toBeNull()
    expect(toSeconds(0)).toBeNull()
  })
})

describe('compactArrivals', () => {
  const now = 1000

  it('keeps arrivals inside the horizon and drops later ones', () => {
    const out = compactArrivals(
      [stu('A', now + 60), stu('B', now + 120), stu('C', now + 1700), stu('D', now + 1900), stu('E', now + 4000)],
      now,
    )
    expect(out.map(([id]) => id)).toEqual(['A', 'B', 'C'])
  })

  it('always keeps the first ARRIVALS_MIN even past the horizon', () => {
    const out = compactArrivals([stu('A', now + 4000), stu('B', now + 5000), stu('C', now + 6000)], now)
    expect(out).toHaveLength(ARRIVALS_MIN)
  })

  it('skips updates with no time or no stop_id, and falls back to departure time', () => {
    const out = compactArrivals(
      [stu('A', undefined), stu(undefined, now + 10), { stopId: 'D', departure: { time: now + 30 } }, stu('B', now + 20)],
      now,
    )
    expect(out).toEqual([
      ['D', now + 30],
      ['B', now + 20],
    ])
  })
})

describe('parseDirection', () => {
  it('prefers the NYCT direction', () => {
    expect(parseDirection(1, 'x_1..S')).toBe('N')
    expect(parseDirection(3, 'x_1..N')).toBe('S')
  })

  it('falls back to the trip_id', () => {
    expect(parseDirection(null, 'x_1..S')).toBe('S')
    expect(parseDirection(undefined, 'x_GS.N04R')).toBe('N')
    expect(parseDirection(null, 'garbage')).toBeNull()
  })
})

describe('compactFeed', () => {
  it('turns a VehiclePosition without a TripUpdate into a trip with no arrivals', () => {
    const { trips } = compactFeed(
      { entity: [{ vehicle: { trip: { tripId: 't1', routeId: 'L' }, stopId: 'L01N', currentStatus: 1, timestamp: 100 } }] },
      200,
    )
    expect(trips).toEqual([
      {
        route: 'L',
        direction: null,
        tripId: 't1',
        trainId: null,
        assigned: false,
        stopId: 'L01N',
        status: 'STOPPED_AT',
        timestamp: 100,
        arrivals: [],
      },
    ])
  })

  it('reports entities without a trip_id as dropped instead of emitting them', () => {
    const { trips, droppedEntities } = compactFeed(
      { entity: [{ tripUpdate: { trip: { routeId: 'L' } } }, { vehicle: {} }, { tripUpdate: { trip: { tripId: 'ok' } } }] },
      0,
    )
    expect(droppedEntities).toBe(2)
    expect(trips.map((t) => t.tripId)).toEqual(['ok'])
  })

  it('skips deleted entities', () => {
    const { trips } = compactFeed({ entity: [{ isDeleted: true, tripUpdate: { trip: { tripId: 'gone' } } }] }, 0)
    expect(trips).toEqual([])
  })
})

describe('buildSnapshot', () => {
  it('isolates a failed feed and keeps the others', () => {
    const snap = buildSnapshot(outcomes({ g: { ok: false, error: 'HTTP 503' } }), L_HEADER + 15)
    expect(snap.feeds.g).toEqual({
      headerTimestamp: null,
      error: 'HTTP 503',
      stale: true,
      trips: [],
      droppedEntities: 0,
    })
    expect(snap.feeds.l).toMatchObject({ headerTimestamp: L_HEADER, error: null, stale: false })
  })

  it('marks an old header stale without an error, and a missing header as an error', () => {
    const snap = buildSnapshot(
      outcomes({ l: { ok: true, message: emptyMessage(L_HEADER - 100) }, g: { ok: true, message: { entity: [] } } }),
      L_HEADER,
    )
    expect(snap.feeds.l).toMatchObject({ stale: true, error: null })
    expect(snap.feeds.g).toMatchObject({ error: 'missing header timestamp', stale: true, headerTimestamp: null })
  })

  it('has one key per feed, the schema version, and the given generatedAt', () => {
    const snap = buildSnapshot(outcomes(), 42)
    expect(Object.keys(snap.feeds)).toEqual([...FEED_IDS])
    expect(snap.version).toBe(RT_SCHEMA_VERSION)
    expect(snap.generatedAt).toBe(42)
  })
})
