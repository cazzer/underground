/** Test helper for the realtime overlay: a scheduled evening on the realtime fixture's stations (Weekday
 *  20261120), and snapshots to lay over it. */
import { FEED_IDS, RT_SCHEMA_VERSION, type Arrival, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import { stations } from '../realtime/fixture'
import { serviceDayStart } from '../realtime/serviceDate'
import { buildTimetable, makePatterns, type PatternInput } from './patterns'
import { buildStopIndex } from './stops'
import type { Timetable } from './types'

export const DAY = '20261120'
/** Epoch seconds of the day's time base: scheduled seconds + D = epoch seconds. */
export const D = serviceDayStart(DAY)
/** 21:35:54, the realtime fixture's clock. */
export const NOW = 1795228554

/** A trip over three stops: 120 s runs, a 30 s dwell at the middle one. */
function run3(id: string, routeId: string, t: number) {
  return { id, routeId, arr: [t, t + 120, t + 270], dep: [t, t + 150, t + 270] }
}

const PATTERNS: PatternInput[] = [
  {
    key: 'one-n',
    stops: ['101N', '102N', '103N'],
    trips: [
      run3('1-2136', '1', 77760),
      run3('1-2140', '1', 78000),
      run3('1-2300', '1', 82800),
      run3('1-2410', '1', 87000),
    ],
  },
  { key: 'one-n05', stops: ['102N', '103N', '104N'], trips: [run3('1x-2140', '1', 78000)] },
  {
    key: 'w-n',
    stops: ['101N', '102N', '103N'],
    trips: [
      run3('W-2100', 'W', 75600),
      run3('W-2127', 'W', 77250),
      run3('W-2133', 'W', 77580),
      run3('W-2230', 'W', 81000),
    ],
  },
  { key: 'si-s', stops: ['S03S', 'S02S', 'S01S'], trips: [run3('SI-2146', 'SI', 78360)] },
]

export function overlayScheduled(): Timetable {
  const index = buildStopIndex({ stopIds: stations.stations.flatMap((s) => s.stops), changeS: new Map(), transfers: [] })
  return buildTimetable(index, PATTERNS.flatMap((p) => makePatterns(index, p)))
}

/** A realtime trip; `arrivals` are [stop, seconds after D]. */
export function rtTrip(tripId: string, route: string, arrivals: [string, number][], over: Partial<RealtimeTrip> = {}): RealtimeTrip {
  const list: Arrival[] = arrivals.map(([stop, t]) => [stop, D + t])
  return {
    route,
    direction: tripId.includes('..N') || tripId.includes('.N') ? 'N' : 'S',
    tripId,
    startDate: DAY,
    trainId: null,
    assigned: true,
    stopId: list[0]?.[0] ?? null,
    status: 'IN_TRANSIT_TO',
    timestamp: NOW - 10,
    arrivals: list,
    ...over,
  }
}

/** A snapshot: feeds not mentioned are healthy and empty, stale ones carry an error and no trips. */
export function snapshotOf(
  trips: Partial<Record<FeedId, RealtimeTrip[]>>,
  opts: { generatedAt: number; stale?: readonly FeedId[] },
): RealtimeSnapshot {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => {
      const stale = opts.stale?.includes(id) ?? false
      return [
        id,
        {
          headerTimestamp: stale ? null : opts.generatedAt,
          error: stale ? 'HTTP 503' : null,
          stale,
          droppedEntities: 0,
          trips: stale ? [] : (trips[id] ?? []),
        },
      ]
    }),
  ) as unknown as RealtimeSnapshot['feeds']
  return { version: RT_SCHEMA_VERSION, generatedAt: opts.generatedAt, feeds }
}
