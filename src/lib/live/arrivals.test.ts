import { describe, expect, it } from 'vitest'
import { ARRIVAL_HORIZON_S, FEED_IDS, RT_SCHEMA_VERSION, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import { lookup } from '../realtime/fixture'
import {
  ARRIVAL_WINDOW_S,
  arrivalsAt,
  formatArrivalTimes,
  MAX_TIMES_PER_GROUP,
  minutesAway,
  PAST_GRACE_S,
  type ArrivalOptions,
} from './arrivals'

const NOW = 1_795_228_554
const ROUTES = new Map([['1', {}], ['W', {}], ['N', {}], ['SI', {}]])
const opts: ArrivalOptions = { lookup, routeById: ROUTES, stationName: (id) => `Stop ${id}` }
const at102 = { id: '102', stops: ['102N', '102S'] }

function trip(tripId: string, route: string, arrivals: [string, number][], over: Partial<RealtimeTrip> = {}): RealtimeTrip {
  return {
    route,
    direction: tripId.includes('..N') || tripId.includes('_N') ? 'N' : 'S',
    tripId,
    startDate: '20261120',
    trainId: null,
    assigned: true,
    stopId: arrivals[0]![0],
    status: 'IN_TRANSIT_TO',
    timestamp: NOW - 15,
    arrivals,
    ...over,
  }
}

function snapshot(trips: RealtimeTrip[]): RealtimeSnapshot {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => [id, { headerTimestamp: NOW, error: null, stale: false, droppedEntities: 0, trips: id === 'l' ? trips : [] }]),
  ) as RealtimeSnapshot['feeds']
  return { version: RT_SCHEMA_VERSION, generatedAt: NOW, feeds }
}

const north = (time: number, extra: [string, number][] = []) =>
  trip('129600_1..N03R', '1', [['102N', time], ...extra])

describe('arrivalsAt', () => {
  it('groups by route, direction and destination: north first, then soonest, both directions', () => {
    const snap = snapshot([
      north(NOW + 600),
      north(NOW + 120, [['103N', NOW + 220]]),
      trip('131000_1..S03R', '1', [['103S', NOW + 10], ['102S', NOW + 90], ['101S', NOW + 200]]),
      trip('128750_N..N70R', 'W', [['102N', NOW + 300]]),
    ])
    expect(arrivalsAt(snap, at102, NOW, opts)).toEqual([
      { routeId: '1', direction: 'N', headsign: 'Stop 103', times: [NOW + 120, NOW + 600] },
      { routeId: 'W', direction: 'N', headsign: 'Stop 103', times: [NOW + 300] },
      { routeId: '1', direction: 'S', headsign: 'Stop 101', times: [NOW + 90] },
    ])
  })

  it('names the destination from the static pattern, not the last predicted stop', () => {
    const [group] = arrivalsAt(snapshot([north(NOW + 100)]), at102, NOW, opts)
    expect(group!.headsign).toBe('Stop 103')
  })

  it('keeps the soonest three, and drops times past the window or further past than the grace', () => {
    const times = [NOW - PAST_GRACE_S - 1, NOW - PAST_GRACE_S, NOW + 60, NOW + 120, NOW + 180, NOW + 240, NOW + ARRIVAL_WINDOW_S + 1]
    const [group, ...rest] = arrivalsAt(snapshot(times.map((t) => north(t))), at102, NOW, opts)
    expect(rest).toEqual([])
    expect(group!.times).toEqual([NOW - PAST_GRACE_S, NOW + 60, NOW + 120])
    expect(group!.times).toHaveLength(MAX_TIMES_PER_GROUP)
  })

  it('ignores other stations and trips with no time here', () => {
    const elsewhere = trip('129600_1..N03R', '1', [['103N', NOW + 60]])
    expect(arrivalsAt(snapshot([elsewhere]), at102, NOW, opts)).toEqual([])
  })

  it('keeps an unassigned trip but drops a stale vehicle', () => {
    const unassigned = north(NOW + 100)
    unassigned.assigned = false
    unassigned.timestamp = null
    const stale = north(NOW + 200)
    stale.timestamp = NOW - 4000
    const groups = arrivalsAt(snapshot([unassigned, stale]), at102, NOW, opts)
    expect(groups.map((g) => g.times)).toEqual([[NOW + 100]])
  })

  it('skips a trip that ends at this station', () => {
    const arriving = trip('129600_1..N03R', '1', [['102N', NOW + 60], ['103N', NOW + 160]])
    const at103 = { id: '103', stops: ['103N', '103S'] }
    expect(arrivalsAt(snapshot([arriving]), at103, NOW, opts)).toEqual([])
  })

  it('falls back to the last predicted stop when the trip id cannot be joined', () => {
    const unjoined = trip('bogus', '1', [['102N', NOW + 60], ['103N', NOW + 160]])
    expect(arrivalsAt(snapshot([unjoined]), at102, NOW, opts)).toEqual([
      { routeId: '1', direction: 'N', headsign: 'Stop 103', times: [NOW + 60] },
    ])
  })

  it('skips an unjoined trip whose predictions end here, even when cut at the horizon', () => {
    const ends = trip('bogus', '1', [['101N', NOW + 60], ['102N', NOW + 160]])
    const cut = trip('bogus', '1', [['101N', NOW + 60], ['102N', NOW + ARRIVAL_HORIZON_S - 10]])
    expect(arrivalsAt(snapshot([ends]), at102, NOW, opts)).toEqual([])
    expect(arrivalsAt(snapshot([cut]), at102, NOW, opts)).toEqual([])
  })

  it('uses the feed route when known, and drops a trip whose route and shape are both unknown', () => {
    const unknown = trip('129600_1..N03R', 'Q', [['102N', NOW + 60]])
    const noRoutes: ArrivalOptions = { ...opts, routeById: new Map() }
    expect(arrivalsAt(snapshot([unknown]), at102, NOW, opts)[0]!.routeId).toBe('1')
    expect(arrivalsAt(snapshot([unknown]), at102, NOW, noRoutes)).toEqual([])
  })
})

describe('formatArrivalTimes', () => {
  // Now on a whole minute, so seconds away and clock minutes away line up.
  const NOW_ON_MINUTE = NOW - (NOW % 60)
  const f = (...deltas: number[]) => formatArrivalTimes(deltas.map((d) => NOW_ON_MINUTE + d), NOW_ON_MINUTE)
  it('says Now under 30 seconds, including already-past times', () => {
    expect(f(29)).toBe('Now')
    expect(f(-20)).toBe('Now')
  })
  it('counts clock minutes down, never below 1', () => {
    expect(f(30)).toBe('1 min')
    expect(f(119)).toBe('1 min')
    expect(f(120)).toBe('2 min')
    expect(f(29 * 60 + 40)).toBe('29 min')
  })
  it('counts the clock minutes between now and the arrival, as the train panel does', () => {
    // 54 s into a minute: 6 s later is the next clock minute, so 35 s away reads 1 min and 95 s reads 2.
    expect(formatArrivalTimes([NOW + 35, NOW + 95], NOW)).toBe('1, 2 min')
    expect(minutesAway(NOW + 330, NOW)).toBe('6')
    expect(minutesAway(NOW + 450, NOW)).toBe('8')
  })
  it('joins several times with one unit', () => {
    expect(f(120, 400, 900)).toBe('2, 6, 15 min')
    expect(f(10, 400)).toBe('Now, 6 min')
    expect(f(5, 20)).toBe('Now')
  })
})
