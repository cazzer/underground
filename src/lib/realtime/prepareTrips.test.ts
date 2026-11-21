import { describe, expect, it } from 'vitest'
import { FEED_IDS, RT_SCHEMA_VERSION, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import { geometries, lookup, segments } from './fixture'
import { hopDistance, positionAlongShape } from './position'
import { prepareTrips } from './prepareTrips'

const NOW = 1_795_228_554

function trip(tripId: string, route: string, over: Partial<RealtimeTrip> = {}): RealtimeTrip {
  return {
    route,
    direction: tripId.includes('N') ? 'N' : 'S',
    tripId,
    startDate: '20261120',
    trainId: null,
    assigned: true,
    stopId: '102N',
    status: 'IN_TRANSIT_TO',
    timestamp: NOW - 15,
    arrivals: [['102N', NOW + 30], ['103N', NOW + 130]],
    ...over,
  }
}

function snapshot(byFeed: Partial<Record<FeedId, RealtimeTrip[]>>): RealtimeSnapshot {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => [
      id,
      { headerTimestamp: NOW, error: null, stale: false, droppedEntities: 0, trips: byFeed[id] ?? [] },
    ]),
  ) as RealtimeSnapshot['feeds']
  return { version: RT_SCHEMA_VERSION, generatedAt: NOW, feeds }
}

describe('prepareTrips', () => {
  it('keeps placeable trips and counts every drop by reason', () => {
    const snap = snapshot({
      si: [
        trip('126600_SI.S03R', 'SI', {
          direction: 'S',
          status: 'STOPPED_AT',
          stopId: 'S02S',
          arrivals: [['S01S', NOW + 60]],
        }),
      ],
      nqrw: [
        trip('128750_W..N', 'W'),
        trip('129600_1..N03R', 'W', { assigned: false }),
        trip('129601_1..N03R', 'W', { timestamp: NOW - 57_600 }),
        trip('129602_1..N03R', 'W', { arrivals: [] }),
        trip('120000_X..N', 'X'),
        trip('129700_1..N03R', '1', { status: 'STOPPED_AT', stopId: 'Z99N' }),
        trip('129800_1..N03R', '1', { stopId: '101N', arrivals: [['101N', NOW + 400]] }),
        trip('129900_1..N03R', '1', { stopId: '101N', arrivals: [['101N', NOW + 100]] }),
      ],
    })
    const { trips, dropped } = prepareTrips(snap, { lookup, geometries, segments }, NOW)

    expect(trips.map((t) => [t.key, t.shapeId, t.stage])).toEqual([
      ['nqrw:128750_W..N', 'N..N70R', 'tripKey'],
      ['nqrw:129900_1..N03R', '1..N03R', 'path'],
      ['si:126600_SI.S03R', 'SI..S03R', 'path'],
    ])
    expect(trips[2]!.geometry).toBe(geometries.get('SI..S03R'))
    expect(dropped).toEqual({
      unassigned: 1,
      'stale-vehicle': 1,
      'no-future-arrival': 1,
      'unparseable-id': 0,
      'unknown-route': 1,
      'off-pattern': 1,
      'no-arrival': 0,
      'not-departed': 1,
    })
  })

  it('throws if a joined shape has no geometry', () => {
    const snap = snapshot({ nqrw: [trip('128750_W..N', 'W')] })
    expect(() => prepareTrips(snap, { lookup, geometries: new Map(), segments }, NOW)).toThrow(/no geometry/)
  })
})

describe('prepareTrips plans', () => {
  it('gives each trip a plan that evaluates to the positionAlongShape distance', () => {
    const snap = snapshot({
      nqrw: [trip('128750_W..N', 'W'), trip('129900_1..N03R', '1', { stopId: '101N', arrivals: [['101N', NOW + 100]] })],
    })
    const { trips } = prepareTrips(snap, { lookup, geometries, segments }, NOW)
    expect(trips).toHaveLength(2)
    for (const t of trips) {
      const placed = positionAlongShape({
        geometry: t.geometry,
        status: t.trip.status,
        stopId: t.trip.stopId,
        arrivals: t.trip.arrivals,
        segments,
        now: NOW + 7,
      })
      if (!placed.ok) throw new Error('unexpected failure')
      expect(hopDistance(t.plan, t.geometry, NOW + 7)).toBe(placed.distance)
    }
  })
})

describe('prepareTrips across polls', () => {
  it('carries the last stop into the next poll and caps a late prediction with the schedule from it', () => {
    const data = { lookup, geometries, segments }
    // At 102N since NOW - 20 (a 100 s hop to 103N), seen there as of the NOW header; then in transit, with the
    // feed still saying 103N at NOW + 130.
    const stopped = trip('129900_1..N03R', '1', { status: 'STOPPED_AT', timestamp: NOW - 20, arrivals: [['102N', NOW - 20], ['103N', NOW + 150]] })
    const first = prepareTrips(snapshot({ '1234567': [stopped] }), data, NOW)
    expect(first.trips[0]!.visit).toEqual({ stopId: '102N', arrivedAt: NOW - 20, seenAt: NOW })
    const moving = trip('129900_1..N03R', '1', { stopId: '103N', timestamp: NOW + 15, arrivals: [['103N', NOW + 130]] })
    const later = prepareTrips(snapshot({ '1234567': [moving] }), data, NOW + 20, new Map(first.trips.map((t) => [t.key, t])))
    expect(later.trips[0]!.visit).toBe(first.trips[0]!.visit)
    expect(later.trips[0]!.plan.arriveAt).toBe(NOW + 80)
    // Without the previous poll there is nothing to cap it with.
    expect(prepareTrips(snapshot({ '1234567': [moving] }), data, NOW + 20).trips[0]!.plan.arriveAt).toBe(NOW + 130)
  })
})
