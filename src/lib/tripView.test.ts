import { describe, expect, it } from 'vitest'
import type { Placement } from './locate'
import type { TripJourney, TripLeg } from './route/plan'
import {
  defaultEnds,
  journeySource,
  journeyView,
  ON_MAP_QUIET_MS,
  orderJourneys,
  shouldAnnounceOnMap,
  shouldAnnounceTrip,
  tripAnnouncement,
  tripMessage,
  tripNowS,
  type TripNames,
  type TripPlanState,
} from './tripView'

// 2027-01-15 13:12:00 UTC is 08:12 in New York.
const T = Date.UTC(2027, 0, 15, 13, 12, 0) / 1000
const NOW = T - 240
const names: TripNames = {
  station: (id) => ({ L08: 'Bedford Av', L03: 'Union Sq', '635': '14 St-Union Sq', '630': 'Lexington Av/63 St', X: 'End' })[id] ?? id,
  route: (id) => id,
}

function ride(routeId: string, board: string, alight: string, departAt: number, arriveAt: number, extra: Partial<TripLeg> = {}): TripLeg {
  return {
    kind: 'ride',
    routeId,
    tripId: `${routeId}-${departAt}`,
    patternKey: 'p',
    boardStop: `${board}N`,
    alightStop: `${alight}N`,
    terminalStop: 'XN',
    stops: ['a', 'b', 'c', 'd', 'e'],
    departAt,
    arriveAt,
    ...extra,
  } as TripLeg
}
function walk(fromStop: string, toStop: string, startAt: number, durationS: number, sameStation: boolean): TripLeg {
  return { kind: 'walk', fromStop, toStop, sameStation, startAt, durationS, endAt: startAt + durationS }
}
function journey(legs: TripLeg[], transfers: number, departAt?: number): TripJourney {
  const first = legs[0]!
  const last = legs.at(-1)!
  return {
    departAt: departAt ?? (first.kind === 'ride' ? first.departAt : first.startAt),
    arriveAt: last.kind === 'ride' ? last.arriveAt : last.endAt,
    transfers,
    legs,
  }
}

describe('journeyView', () => {
  it('reads one ride: clocks, headsign, stop count and names', () => {
    const v = journeyView(journey([ride('L', 'L08', 'L03', T, T + 480)], 0), NOW, names)
    expect(v).toMatchObject({
      departClock: '8:12',
      departAway: '4 min',
      arriveClock: '8:20',
      minutes: 8,
      transfersText: 'No transfers',
      routes: ['L'],
      source: 'scheduled',
      sourceText: 'Scheduled',
    })
    expect(v.legs).toEqual([
      {
        kind: 'ride',
        routeId: 'L',
        tripId: `L-${T}`,
        live: false,
        headsign: 'End',
        board: { stationId: 'L08', name: 'Bedford Av', clock: '8:12' },
        alight: { stationId: 'L03', name: 'Union Sq', clock: '8:20' },
        stopsText: '4 stops',
      },
    ])
    expect(v.spoken).toBe('Leaves 8:12, in 4 minutes. Arrives 8:20. 8 minutes, no transfers: L. Scheduled.')
  })

  it('counts the duration on the clock face across a minute boundary', () => {
    const v = journeyView(journey([ride('L', 'L08', 'L03', T + 50, T + 70)], 0), NOW, names)
    expect(v.minutes).toBe(1)
  })

  it('says one stop in the singular', () => {
    const v = journeyView(journey([ride('L', 'L08', 'L03', T, T + 120, { stops: ['a', 'b'] })], 0), NOW, names)
    expect(v.legs[0]).toMatchObject({ stopsText: '1 stop' })
  })

  it('joins two rides with a 0 s change that has no minutes', () => {
    const legs = [ride('L', 'L08', '635', T, T + 600), walk('635N', '635N', T + 600, 0, true), ride('4', '635', '630', T + 660, T + 900)]
    const v = journeyView(journey(legs, 1), NOW, names)
    expect(v.legs[1]).toEqual({ kind: 'change', stationId: '635', name: '14 St-Union Sq', minutes: null })
    expect(v.transfersText).toBe('1 transfer')
    expect(v.routes).toEqual(['L', '4'])
    expect(v.spoken).toContain('15 minutes, 1 transfer: L, then 4.')
  })

  it('shows a 180 s change as 3 min', () => {
    const legs = [ride('L', 'L08', '635', T, T + 600), walk('635N', '635S', T + 600, 180, true), ride('4', '635', '630', T + 780, T + 900)]
    expect(journeyView(journey(legs, 1), NOW, names).legs[1]).toMatchObject({ kind: 'change', minutes: 3 })
  })

  it('shows a walk between stations as "Walk to Y" with its minutes', () => {
    const legs = [ride('L', 'L08', '635', T, T + 600), walk('635N', '630N', T + 600, 300, false), ride('4', '630', 'L03', T + 960, T + 1200)]
    const v = journeyView(journey(legs, 2), NOW, names)
    expect(v.legs[1]).toEqual({ kind: 'walk', toStationId: '630', to: 'Lexington Av/63 St', minutes: 5 })
    expect(v.transfersText).toBe('2 transfers')
  })

  it('calls a walk between two stations of one name a change', () => {
    const named: TripNames = { ...names, station: (id) => (id === 'L03' ? 'Union Sq' : id === '635' ? 'Union Sq' : names.station(id)) }
    const legs = [ride('L', 'L08', 'L03', T, T + 600), walk('L03N', '635N', T + 600, 180, false), ride('4', '635', '630', T + 840, T + 1200)]
    expect(journeyView(journey(legs, 1), NOW, named).legs[1]).toEqual({ kind: 'change', stationId: '635', name: 'Union Sq', minutes: 3 })
  })

  it('rounds a short walk up to one minute', () => {
    const legs = [ride('L', 'L08', '635', T, T + 600), walk('635N', '630N', T + 600, 20, false)]
    expect(journeyView(journey(legs, 1), NOW, names).legs[1]).toMatchObject({ kind: 'walk', minutes: 1 })
  })

  it('departs with the first train, not when a leading walk starts', () => {
    const legs = [walk('L08N', '635N', T - 300, 240, false), ride('L', '635', 'L03', T, T + 300)]
    const v = journeyView(journey(legs, 0, T - 300), NOW, names)
    expect(v.departClock).toBe('8:12')
    expect(v.minutes).toBe(5)
    expect(v.legs[0]).toMatchObject({ kind: 'walk' })
  })

  it('reads a walk-only journey as one walk leg departing when it starts', () => {
    const v = journeyView(journey([walk('L08N', '635N', T, 600, false)], 0), NOW, names)
    expect(v.legs).toHaveLength(1)
    expect(v.routes).toEqual([])
    expect(v.departClock).toBe('8:12')
    expect(v.spoken).toBe('Leaves 8:12, in 4 minutes. Arrives 8:22. 10 minutes, no transfers. Scheduled.')
  })

  it('says "now" when the train is under 30 s away', () => {
    const v = journeyView(journey([ride('L', 'L08', 'L03', T, T + 480)], 0), T - 20, names)
    expect(v.departAway).toBe('Now')
    expect(v.spoken.startsWith('Leaves now. Arrives 8:20.')).toBe(true)
  })

  it('keys a journey by the trips it rides, so a refresh keeps its place', () => {
    const a = journeyView(journey([ride('L', 'L08', 'L03', T, T + 480)], 0), NOW, names)
    const b = journeyView(journey([ride('L', 'L08', 'L03', T, T + 480)], 0), NOW + 30, names)
    expect(a.key).toBe(b.key)
  })
})

describe('orderJourneys', () => {
  it('sorts by arrival, then transfers, then departure, without changing its input', () => {
    const j = (departAt: number, arriveAt: number, transfers: number): TripJourney => ({ departAt, arriveAt, transfers, legs: [] })
    const input = [j(0, 900, 0), j(0, 600, 1), j(0, 600, 0), j(-60, 600, 0)]
    const out = orderJourneys(input)
    expect(out.map((x) => [x.departAt, x.arriveAt, x.transfers])).toEqual([
      [-60, 600, 0],
      [0, 600, 0],
      [0, 600, 1],
      [0, 900, 0],
    ])
    expect(input[0]!.arriveAt).toBe(900)
  })
})

describe('tripMessage', () => {
  const ready = (journeys: TripJourney[], key = 'A>B'): TripPlanState => ({ status: 'ready', key, attempt: 1, trigger: 'ends', atS: T, journeys })
  const both = { from: 'A', to: 'B' }
  it('asks for the missing end, then names a same-station pair', () => {
    expect(tripMessage({ from: null, to: null }, { status: 'idle' }, false)).toBe('Choose a starting station')
    expect(tripMessage({ from: 'A', to: null }, { status: 'idle' }, false)).toBe('Choose a destination')
    expect(tripMessage({ from: 'A', to: 'A' }, { status: 'idle' }, false)).toBe('From and To are the same station')
  })
  it('shows "Finding trips…" only once showLoading is on', () => {
    const loading: TripPlanState = { status: 'loading', key: 'A>B' }
    expect(tripMessage(both, loading, false)).toBeNull()
    expect(tripMessage(both, loading, true)).toBe('Finding trips…')
  })
  it('treats a plan for other ends as not there yet', () => {
    expect(tripMessage(both, ready([], 'A>C'), true)).toBe('Finding trips…')
  })
  it('says nothing for journeys and names an empty result', () => {
    const one: TripJourney = { departAt: 0, arriveAt: 1, transfers: 0, legs: [] }
    expect(tripMessage(both, ready([one]), true)).toBeNull()
    expect(tripMessage(both, ready([]), true)).toBe('No trip found between these stations')
  })
  it('names two ends in one complex as the same station, not an empty result', () => {
    expect(tripMessage(both, { ...ready([]), sameStation: true } as TripPlanState, false)).toBe('From and To are the same station')
  })
  it('names the date with no timetable, and a load failure', () => {
    const base = { key: 'A>B', attempt: 1, trigger: 'ends' as const }
    expect(tripMessage(both, { status: 'noService', date: '20261201', ...base }, false)).toBe(
      'No timetable for Tue, Dec 1. The schedule may be out of date.',
    )
    expect(tripMessage(both, { status: 'error', message: 'x', ...base }, false)).toBe("Couldn't load the timetable")
  })
})

describe('journeySource', () => {
  const live = (routeId: string, board: string, alight: string, a: number, b: number, tripId?: string) =>
    ride(routeId, board, alight, a, b, tripId ? { live: true, tripId } : { live: true })
  const sched = (routeId: string, board: string, alight: string, a: number, b: number) => ride(routeId, board, alight, a, b, { live: false })
  it('is Live when every ride leg is live, walks aside', () => {
    const two = journey([live('L', 'L08', 'L03', T, T + 300), walk('L03N', '635N', T + 300, 120, false), live('4', '635', '630', T + 600, T + 900)], 1)
    expect(journeySource(two)).toBe('live')
    expect(journeySource(journey([live('L', 'L08', 'L03', T, T + 300)], 0))).toBe('live')
  })
  it('is Live and scheduled when some ride legs are', () => {
    expect(journeySource(journey([live('L', 'L08', 'L03', T, T + 300), sched('4', 'L03', '630', T + 600, T + 900)], 1))).toBe('mixed')
  })
  it('is Scheduled when none are, and for a walk-only journey', () => {
    expect(journeySource(journey([sched('L', 'L08', 'L03', T, T + 300)], 0))).toBe('scheduled')
    expect(journeySource(journey([walk('L08N', 'L03N', T, 300, false)], 0))).toBe('scheduled')
  })
  it('keeps the journey key when only trip ids change (a scheduled train swapped for its live twin)', () => {
    const scheduled = journey([sched('L', 'L08', 'L03', T, T + 300), walk('L03N', '635N', T + 300, 120, false), sched('4', '635', '630', T + 600, T + 900)], 1)
    const swapped = journey(
      [live('L', 'L08', 'L03', T + 60, T + 360, 'live-1'), walk('L03N', '635N', T + 360, 120, false), live('4', '635', '630', T + 660, T + 960, 'live-2')],
      1,
    )
    const a = journeyView(scheduled, NOW, names).key
    expect(a).toBe('L:L08N:L03N>walk:L03N:635N>4:635N:630N')
    expect(journeyView(swapped, NOW, names).key).toBe(a)
    expect(journeyView(journey([sched('L', 'L08', 'L03', T, T + 300)], 0), NOW, names).key).not.toBe(a)
  })
  it('ends the spoken sentence with the same words and marks each leg', () => {
    const v = journeyView(journey([live('L', 'L08', 'L03', T, T + 300), sched('4', 'L03', '630', T + 600, T + 900)], 1), NOW, names)
    expect(v).toMatchObject({ source: 'mixed', sourceText: 'Live and scheduled' })
    expect(v.spoken.endsWith(' Live and scheduled.')).toBe(true)
    expect(v.legs.flatMap((l) => (l.kind === 'ride' ? [l.live] : []))).toEqual([true, false])
    const all = journeyView(journey([live('L', 'L08', 'L03', T, T + 300)], 0), NOW, names)
    expect(all).toMatchObject({ source: 'live', sourceText: 'Live' })
    expect(all.spoken.endsWith(' Live.')).toBe(true)
  })
})

describe('tripAnnouncement and shouldAnnounceTrip', () => {
  const one = journeyView(journey([ride('L', 'L08', 'L03', T, T + 2100)], 1), NOW, names)
  const ready = (trigger: 'ends' | 'tick' | 'poll' | 'retry', attempt = 1, key = 'A>B'): TripPlanState => ({
    status: 'ready',
    key,
    attempt,
    trigger,
    atS: T,
    journeys: [],
  })
  it('counts trips and gives the first arrival', () => {
    expect(tripAnnouncement({ from: 'A', to: 'B' }, ready('ends'), [one, one])).toBe('2 trips. First arrives 8:47, 35 minutes, 1 transfer.')
    expect(tripAnnouncement({ from: 'A', to: 'B' }, ready('ends'), [one])).toMatch(/^1 trip\. /)
  })
  it('falls back to the message when nothing is ready to list', () => {
    expect(tripAnnouncement({ from: 'A', to: 'B' }, ready('ends'), [])).toBe('No trip found between these stations')
  })
  it('announces a settled plan once, and not a refresh', () => {
    expect(shouldAnnounceTrip({ status: 'idle' }, null)).toBe(false)
    expect(shouldAnnounceTrip({ status: 'loading', key: 'A>B' }, null)).toBe(false)
    expect(shouldAnnounceTrip(ready('ends'), null)).toBe(true)
    expect(shouldAnnounceTrip(ready('ends'), 'A>B#1')).toBe(false)
    expect(shouldAnnounceTrip(ready('tick'), null)).toBe(false)
    expect(shouldAnnounceTrip(ready('poll'), null)).toBe(false)
    expect(shouldAnnounceTrip(ready('poll', 2, 'A>C'), 'A>B#1')).toBe(false)
  })
  it('announces new ends and a retry of the same ends', () => {
    expect(shouldAnnounceTrip(ready('ends', 2, 'A>C'), 'A>B#1')).toBe(true)
    expect(shouldAnnounceTrip(ready('retry', 2), 'A>B#1')).toBe(true)
    const failed: TripPlanState = { status: 'error', message: 'x', key: 'A>B', attempt: 2, trigger: 'retry' }
    expect(shouldAnnounceTrip(failed, 'A>B#1')).toBe(true)
  })
})

describe('defaultEnds', () => {
  const nearest = { id: 'L08', name: 'Bedford Av', pos: { x: 0, z: 0 }, distanceM: 100 }
  const marked = (kind: 'near' | 'far'): Placement =>
    ({ kind, ground: { x: 0, z: 0 }, accuracyM: 10, approximate: false, nearest, viewCenter: { x: 0, z: 0 }, viewRadiusM: 300 }) as Placement
  it('uses the nearest station as From and a different focused station as To', () => {
    expect(defaultEnds('635', marked('near'))).toEqual({ from: 'L08', to: '635' })
    expect(defaultEnds('635', marked('far'))).toEqual({ from: 'L08', to: '635' })
  })
  it('leaves To empty when the focused station is the nearest one, or none is focused', () => {
    expect(defaultEnds('L08', marked('near'))).toEqual({ from: 'L08', to: null })
    expect(defaultEnds(null, marked('far'))).toEqual({ from: 'L08', to: null })
  })
  it('ignores an outside fix', () => {
    expect(defaultEnds('635', { kind: 'outside', nearest })).toEqual({ from: '635', to: null })
  })
  it('makes the focused station From when there is no fix', () => {
    expect(defaultEnds('635', null)).toEqual({ from: '635', to: null })
    expect(defaultEnds(null, null)).toEqual({ from: null, to: null })
  })
})

describe('tripNowS', () => {
  it('reads the live clock when a snapshot has set it, else the device clock', () => {
    expect(tripNowS({ offsetS: 1000 }, 5000, 9e12)).toBe(1005)
    expect(tripNowS(null, 5000, 1_800_000_000_000)).toBe(1_800_000_000)
  })
})

describe('shouldAnnounceOnMap', () => {
  const base = { focusedId: 'X', previousId: 'Y', shown: true, isEnd: false, planLoading: false, sinceSettledMs: null }
  it('says a station that newly took focus while the panel is in front', () => {
    expect(shouldAnnounceOnMap(base)).toBe(true)
    expect(shouldAnnounceOnMap({ ...base, previousId: null })).toBe(true)
  })
  it('stays silent when focus did not change (opening, a swap, an end pick, the cover going)', () => {
    expect(shouldAnnounceOnMap({ ...base, previousId: 'X' })).toBe(false)
  })
  it('stays silent with nothing focused, the panel not in front, or an end focused', () => {
    expect(shouldAnnounceOnMap({ ...base, focusedId: null })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, shown: false })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, isEnd: true })).toBe(false)
  })
  it('never talks over a loading or just-settled result', () => {
    expect(shouldAnnounceOnMap({ ...base, planLoading: true })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, sinceSettledMs: ON_MAP_QUIET_MS - 1 })).toBe(false)
    expect(shouldAnnounceOnMap({ ...base, sinceSettledMs: ON_MAP_QUIET_MS })).toBe(true)
  })
})
