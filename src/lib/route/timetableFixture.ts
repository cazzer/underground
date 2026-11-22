/** Test helper: a small timetable on the realtime fixture's stations. */
import type { StationId } from '../../data/schema'
import { stations } from '../realtime/fixture'
import { buildTimetable, makePatterns, type PatternInput, type TripInput } from './patterns'
import { buildStopIndex } from './stops'
import type { Timetable } from './types'

/** Seconds at `x` minutes past 08:00. */
export const m = (x: number): number => 28800 + 60 * x

/** A trip from [arrive, depart] pairs. */
function through(id: string, routeId: string, ...times: [number, number][]): TripInput {
  return { id, routeId, arr: times.map(([a]) => a), dep: times.map(([, d]) => d) }
}
/** A stop's [arrive, depart]; a stop with no dwell gives one time. */
const at = (a: number, d = a): [number, number] => [a, d]

// 1 and W share main-n; the 1x trips run 102 to 104, so 101 to 104 needs a change at 102 or 103.
// 104 and S03 are 240 s apart on foot; SI runs from S03 down to S01.
const PATTERNS: PatternInput[] = [
  {
    key: 'main-n',
    stops: ['101N', '102N', '103N'],
    trips: [
      through('W-0800', 'W', at(m(0)), at(m(2), m(2.5)), at(m(4.5))),
      through('1-0810', '1', at(m(10)), at(m(12), m(12.5)), at(m(14.5))),
      through('W-2410', 'W', at(87000), at(87120, 87150), at(87270)),
    ],
  },
  {
    key: 'loop-n',
    stops: ['102N', '103N', '104N'],
    trips: [
      through('1x-0804', '1', at(m(4)), at(m(6), m(6.5)), at(m(8.5))),
      through('1x-0806', '1', at(m(6)), at(m(8), m(8.5)), at(m(10.5))),
    ],
  },
  {
    key: 'thru-n',
    stops: ['101N', '102N', '103N', '104N'],
    trips: [through('1t-0801', '1', at(m(1)), at(m(3), m(3.5)), at(m(5.5), m(6)), at(m(12)))],
  },
  {
    key: 'si-s',
    stops: ['S03S', 'S02S', 'S01S'],
    trips: [
      through('SI-0815', 'SI', at(m(15)), at(m(17), m(17.5)), at(m(19.5))),
      through('SI-0830', 'SI', at(m(30)), at(m(32), m(32.5)), at(m(34.5))),
    ],
  },
]

export function fixtureTimetable(changeS: ReadonlyMap<StationId, number> = new Map()): Timetable {
  const index = buildStopIndex({
    stopIds: stations.stations.flatMap((s) => s.stops),
    changeS,
    transfers: [
      { from: '104', to: 'S03', minTransferSec: 240 },
      { from: 'S03', to: '104', minTransferSec: 240 },
    ],
  })
  return buildTimetable(index, PATTERNS.flatMap((p) => makePatterns(index, p)))
}
