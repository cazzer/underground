import { describe, expect, it } from 'vitest'
import { ARRIVAL_HORIZON_S, FEED_IDS, RT_SCHEMA_VERSION, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import { ARRIVAL_SHIFT_S, shownArrival } from '../realtime/arrivalShift'
import { lookup } from '../realtime/fixture'
import {
  ARRIVAL_WINDOW_S,
  arrivalsAt,
  DEPARTURE_NOW_UNDER_S,
  formatArrivalTimes,
  MAX_TIMES_PER_GROUP,
  minutesAway,
  NOW_UNDER_S,
  PAST_GRACE_S,
  selectableArrival,
  type ArrivalOptions,
} from './arrivals'

const NOW = 1_795_228_554
const ROUTES = new Map([['1', {}], ['W', {}], ['N', {}], ['SI', {}]])
const opts: ArrivalOptions = { lookup, routeById: ROUTES, stationName: (id) => `Stop ${id}` }
/** The fixture trips ride the L feed: a predicted time as the panel shows it. */
const shown = (t: number): number => t - ARRIVAL_SHIFT_S.l
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

function snapshot(trips: RealtimeTrip[], other: Partial<Record<FeedId, RealtimeTrip[]>> = {}): RealtimeSnapshot {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => [id, { headerTimestamp: NOW, error: null, stale: false, droppedEntities: 0, trips: id === 'l' ? trips : (other[id] ?? []) }]),
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
      { routeId: '1', direction: 'N', headsign: 'Stop 103', times: [shown(NOW + 120), shown(NOW + 600)], tripKeys: ['l:129600_1..N03R', 'l:129600_1..N03R'] },
      { routeId: 'W', direction: 'N', headsign: 'Stop 103', times: [shown(NOW + 300)], tripKeys: ['l:128750_N..N70R'] },
      { routeId: '1', direction: 'S', headsign: 'Stop 101', times: [shown(NOW + 90)], tripKeys: ['l:131000_1..S03R'] },
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
    expect(group!.times).toEqual([shown(NOW - PAST_GRACE_S), shown(NOW + 60), shown(NOW + 120)])
    expect(group!.times).toHaveLength(MAX_TIMES_PER_GROUP)
  })

  it('keeps a trip by its predicted time but lists its shifted one, so a train past its shown time is still a row', () => {
    // 20 s past the prediction, 50 s past what the panel shows: inside PAST_GRACE_S by the feed, so still listed.
    const lateS = PAST_GRACE_S - 10
    const [group] = arrivalsAt(snapshot([north(NOW - lateS)]), at102, NOW, opts)
    expect(group!.times).toEqual([NOW - lateS - ARRIVAL_SHIFT_S.l])
    expect(minutesAway(group!.times[0]!, NOW)).toBe('Now')
  })

  it('keeps the raw time of the stop a train stands at, a departure, not an arrival', () => {
    // Laid over at 102N with its departure 40 s out: shifting it would show the train leaving early.
    const standing = north(NOW + 40, [['103N', NOW + 140]])
    standing.status = 'STOPPED_AT'
    const [group] = arrivalsAt(snapshot([standing]), at102, NOW, opts)
    expect(group!.times).toEqual([NOW + 40])
    // The same trip in transit is an arrival, shifted.
    const [moving] = arrivalsAt(snapshot([north(NOW + 40, [['103N', NOW + 140]])]), at102, NOW, opts)
    expect(moving!.times).toEqual([shown(NOW + 40)])
  })

  it('sorts across feeds by the shown time, not the predicted one', () => {
    // The nqrw one is predicted first, but its feed is shifted less than the L's: shown, the L's comes first.
    const lTrip = trip('129700_1..N03R', '1', [['102N', NOW + 110]])
    const nqrw = trip('129600_1..N03R', '1', [['102N', NOW + 100]])
    const [group] = arrivalsAt(snapshot([lTrip], { nqrw: [nqrw] }), at102, NOW, opts)
    expect(group!.times).toEqual([shownArrival('l', NOW + 110), shownArrival('nqrw', NOW + 100)])
    expect(group!.tripKeys).toEqual(['l:129700_1..N03R', 'nqrw:129600_1..N03R'])
    expect(selectableArrival(group!, new Set(['nqrw:129600_1..N03R']))).toEqual({ tripKey: 'nqrw:129600_1..N03R', time: shownArrival('nqrw', NOW + 100) })
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
    expect(groups.map((g) => g.times)).toEqual([[shown(NOW + 100)]])
  })

  it('skips a trip that ends at this station', () => {
    const arriving = trip('129600_1..N03R', '1', [['102N', NOW + 60], ['103N', NOW + 160]])
    const at103 = { id: '103', stops: ['103N', '103S'] }
    expect(arrivalsAt(snapshot([arriving]), at103, NOW, opts)).toEqual([])
  })

  it('falls back to the last predicted stop when the trip id cannot be joined', () => {
    const unjoined = trip('bogus', '1', [['102N', NOW + 60], ['103N', NOW + 160]])
    expect(arrivalsAt(snapshot([unjoined]), at102, NOW, opts)).toEqual([
      { routeId: '1', direction: 'N', headsign: 'Stop 103', times: [shown(NOW + 60)], tripKeys: ['l:bogus'] },
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

describe('arrivalsAt for a station complex', () => {
  // Stations 102 and 103 as one: both members' stops, the north terminal (103) is one of them.
  const both = { id: '102', stops: ['102N', '102S', '103N', '103S'], memberIds: ['102', '103'] }
  const south = (tripId: string, arrivals: [string, number][]) => trip(tripId, '1', arrivals)

  it('lists the trips of every member', () => {
    const snap = snapshot([
      south('131000_1..S03R', [['103S', NOW + 100], ['101S', NOW + 400]]),
      south('131100_1..S03R', [['102S', NOW + 200], ['101S', NOW + 500]]),
    ])
    const [group] = arrivalsAt(snap, both, NOW, opts)
    expect(group).toMatchObject({ direction: 'S', headsign: 'Stop 101', times: [shown(NOW + 100), shown(NOW + 200)] })
  })

  it('skips a trip ending at any member, not only the lead', () => {
    // The 1 north ends at 103: a member, so nobody boards it anywhere in the complex.
    expect(arrivalsAt(snapshot([north(NOW + 100)]), both, NOW, opts)).toEqual([])
    expect(arrivalsAt(snapshot([north(NOW + 100)]), { id: '102', stops: ['102N', '102S'] }, NOW, opts)).toHaveLength(1)
  })

  it('lists a trip seen at two members once, at its soonest', () => {
    const snap = snapshot([south('131000_1..S03R', [['103S', NOW + 100], ['102S', NOW + 160], ['101S', NOW + 400]])])
    const groups = arrivalsAt(snap, both, NOW, opts)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.times).toEqual([shown(NOW + 100)])
    expect(groups[0]!.tripKeys).toEqual(['l:131000_1..S03R'])
  })

  it('orders north first, then soonest', () => {
    const pair = { id: '102', stops: ['102N', '102S', '999N'], memberIds: ['102', '999'] }
    const snap = snapshot([
      south('131000_1..S03R', [['102S', NOW + 10], ['101S', NOW + 300]]),
      trip('128750_N..N70R', 'W', [['102N', NOW + 300]]),
      north(NOW + 100),
    ])
    expect(arrivalsAt(snap, pair, NOW, opts).map((g) => `${g.direction}${g.routeId}`)).toEqual(['N1', 'NW', 'S1'])
  })
})

describe('trip keys', () => {
  const trips = [
    trip('129600_1..N03R', '1', [['102N', NOW + 600]]),
    trip('129700_1..N03R', '1', [['102N', NOW + 100]]),
    trip('129800_1..N03R', '1', [['102N', NOW + 300]], { assigned: false, timestamp: null }),
  ]
  const [group] = arrivalsAt(snapshot(trips), at102, NOW, opts)

  it('keeps each time\'s trip key in step through the sort, as the map keys the trip', () => {
    expect(group!.times).toEqual([shown(NOW + 100), shown(NOW + 300), shown(NOW + 600)])
    expect(group!.tripKeys).toEqual(['l:129700_1..N03R', 'l:129800_1..N03R', 'l:129600_1..N03R'])
  })

  it('selects the soonest arrival whose train is drawn, and none when no train is', () => {
    const drawn = new Set(['l:129600_1..N03R', 'l:129700_1..N03R'])
    expect(selectableArrival(group!, drawn)).toEqual({ tripKey: 'l:129700_1..N03R', time: shown(NOW + 100) })
    // The not-yet-dispatched 129800 is listed but not drawn: the row skips to the next drawn train.
    expect(selectableArrival(group!, new Set(['l:129600_1..N03R']))).toEqual({ tripKey: 'l:129600_1..N03R', time: shown(NOW + 600) })
    expect(selectableArrival(group!, new Set())).toBeNull()
  })
})

/** Between the two Now windows. */
const MID_S = (NOW_UNDER_S + DEPARTURE_NOW_UNDER_S) / 2

describe('formatArrivalTimes', () => {
  // Now on a whole minute, so seconds away and clock minutes away line up.
  const NOW_ON_MINUTE = NOW - (NOW % 60)
  const f = (...deltas: number[]) => formatArrivalTimes(deltas.map((d) => NOW_ON_MINUTE + d), NOW_ON_MINUTE)
  it(`says Now under ${NOW_UNDER_S} seconds, including already-past times`, () => {
    expect(f(NOW_UNDER_S - 1)).toBe('Now')
    expect(f(-20)).toBe('Now')
  })
  it('reads a departure\'s own, shorter Now window when asked', () => {
    expect(minutesAway(NOW_ON_MINUTE + MID_S, NOW_ON_MINUTE)).toBe('Now')
    expect(minutesAway(NOW_ON_MINUTE + MID_S, NOW_ON_MINUTE, DEPARTURE_NOW_UNDER_S)).toBe('1')
  })
  it('counts clock minutes down, never below 1', () => {
    expect(f(NOW_UNDER_S)).toBe('1 min')
    expect(f(119)).toBe('1 min')
    expect(f(120)).toBe('2 min')
    expect(f(29 * 60 + 40)).toBe('29 min')
  })
  it('counts the clock minutes between now and the arrival, as the train panel does', () => {
    // 54 s into a minute: 6 s later is the next clock minute, so 50 s away reads 1 min and 95 s reads 2.
    expect(formatArrivalTimes([NOW + 50, NOW + 95], NOW)).toBe('1, 2 min')
    expect(minutesAway(NOW + 330, NOW)).toBe('6')
    expect(minutesAway(NOW + 450, NOW)).toBe('8')
  })
  it('joins several times with one unit', () => {
    expect(f(120, 400, 900)).toBe('2, 6, 15 min')
    expect(f(10, 400)).toBe('Now, 6 min')
    expect(f(5, 20)).toBe('Now')
  })
})
