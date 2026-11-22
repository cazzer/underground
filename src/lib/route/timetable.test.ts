import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transfer } from '../../data/schema'
import type { StationChange, TimetableFile, TimetablePattern, TimetableTrip } from '../../data/timetableSchema'
import { stations } from '../realtime/fixture'
import { route } from './raptor'
import { DEFAULT_CHANGE_S } from './stops'
import { buildRouterTimetable, type TimetableSource } from './timetable'
import type { Timetable } from './types'

// Times in the files are 30 s units: 960 = 08:00.
const MAIN = ['101N', '102N', '103N']
const pattern = (stops: string[], trips: TimetableTrip[], routeId = 'W'): TimetablePattern => ({
  routeId,
  direction: 'N',
  stops,
  trips,
})
const file = (patterns: TimetablePattern[], changes: StationChange[] = []): TimetableFile => ({
  format: 1,
  feedVersion: 'test',
  services: ['Weekday'],
  changes,
  patterns,
})
const source = (f: TimetableFile, label = 'D:Weekday', shiftS = 0): TimetableSource => ({ label, shiftS, file: f })
const build = (sources: TimetableSource[], transfers: Transfer[] = []): Timetable =>
  buildRouterTimetable(sources, stations, transfers)

const footS = (tt: Timetable, from: string, to: string): number | undefined => {
  const { stopOf, footStart, footTo, footS: seconds } = tt.stops
  const p = stopOf.get(from)!
  for (let i = footStart[p]!; i < footStart[p + 1]!; i++) if (footTo[i] === stopOf.get(to)) return seconds[i]
  return undefined
}

afterEach(() => vi.restoreAllMocks())

describe('buildRouterTimetable', () => {
  it('keeps two lanes of one stop sequence apart and routes on the faster one', () => {
    const slow: TimetableTrip = [960, [10, 10]]
    const fast: TimetableTrip = [961, [2, 2]] // leaves later, arrives first
    const tt = build([source(file([pattern(MAIN, [slow]), pattern(MAIN, [fast])]))])
    expect(tt.patterns.map((p) => p.key)).toEqual(['D:Weekday/0', 'D:Weekday/1'])
    const [journey] = route(tt, ['101'], ['103'], 28800)
    const ride = journey!.legs[0]!
    expect(ride).toMatchObject({ kind: 'ride', tripId: 'D:Weekday/1/0', arriveS: 28830 + 120 })
  })

  it('skips unknown stops, keeping the known stops times, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const trip: TimetableTrip = [960, [4, 4]]
    const f = file([pattern(['101N', '999N', '103N'], [trip]), pattern(['998N', '103N'], [[960, [2]]])])
    const tt = build([source(f)])
    expect(tt.patterns).toHaveLength(1)
    const [p] = tt.patterns
    expect(p!.stops.length).toBe(2)
    // 101N at 08:00; 103N 8 units (240 s) later, as in the file.
    expect(Array.from(p!.arr)).toEqual([28800, 29040])
    expect(Array.from(p!.dep)).toEqual([28800, 29040])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/999N.*998N|998N.*999N/)
  })

  it('ignores unknown stations in changes and transfers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = file([pattern(MAIN, [[960, [4, 4]]])], [{ station: '999', minTransferSec: 30 }])
    const tt = build([source(f)], [{ from: '998', to: '101', minTransferSec: 60 }])
    expect(tt.patterns).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/999.*998|998.*999/)
  })

  it('does not warn when everything is known', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    build([source(file([pattern(MAIN, [[960, [4, 4]]])]))])
    expect(warn).not.toHaveBeenCalled()
  })

  it('shifts a source, so a past-midnight trip of yesterday boards early today', () => {
    const f = file([pattern(MAIN, [[3000, [4, 4]]])]) // 25:00 on the file's own day
    const tt = build([source(f, 'Y:Sunday', -86400)])
    const [journey] = route(tt, ['101'], ['103'], 1800)
    expect(journey!.legs[0]).toMatchObject({ kind: 'ride', departS: 3600 })
    expect((journey!.legs[0] as { tripId: string }).tripId.startsWith('Y:Sunday/')).toBe(true)
  })

  it('takes change times from the files and leaves other stations at the default', () => {
    const tt = build([source(file([pattern(MAIN, [[960, [4, 4]]])], [{ station: '102', minTransferSec: 0 }]))])
    expect(footS(tt, '102N', '102S')).toBe(0)
    expect(footS(tt, '101N', '101S')).toBe(DEFAULT_CHANGE_S)
  })

  it('keeps a station no trip serves, so routing to it finds nothing', () => {
    const tt = build([source(file([pattern(MAIN, [[960, [4, 4]]])]))])
    expect(route(tt, ['101'], ['S01'], 28800)).toEqual([])
  })
})
