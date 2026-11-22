import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transfer } from '../../data/schema'
import type { StationChange, TimetableFile, TimetablePattern, TimetableTrip } from '../../data/timetableSchema'
import { stations } from '../realtime/fixture'
import { route } from './raptor'
import { DEFAULT_CHANGE_S } from './stops'
import type { ServiceWindow } from './serviceDay'
import { buildRouterTimetable, sourcesFor, type TimetableSource } from './timetable'
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

  it('skips a station with no stops instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bare = { ...stations, stations: [...stations.stations, { ...stations.stations[0]!, id: 'ZZ', stops: [] }] }
    const f = file([pattern(MAIN, [[960, [4, 4]]])], [{ station: 'ZZ', minTransferSec: 30 }])
    const tt = buildRouterTimetable([source(f)], bare, [{ from: 'ZZ', to: '101', minTransferSec: 60 }])
    expect(tt.patterns).toHaveLength(1)
    expect(warn.mock.calls[0]![0]).toContain('ZZ')
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

describe('sourcesFor', () => {
  const window: ServiceWindow = {
    date: '20261127',
    startS: 0,
    frames: [
      { date: '20261126', services: ['Sunday'], shiftS: -86400, dated: false },
      { date: '20261127', services: ['Weekday'], shiftS: 0, dated: false },
    ],
  }
  const sunday = { ...file([]), services: ['Sunday'] }
  const weekday = { ...file([]), services: ['Weekday'] }

  it('labels each frame and service and carries the frame shift', () => {
    const sources = sourcesFor(window, new Map([['Sunday', sunday], ['Weekday', weekday]]))
    expect(sources).toEqual([
      { label: '20261126:Sunday', shiftS: -86400, file: sunday },
      { label: '20261127:Weekday', shiftS: 0, file: weekday },
    ])
  })

  it('throws for a service with no file', () => {
    expect(() => sourcesFor(window, new Map([['Weekday', weekday]]))).toThrow('no timetable file for service Sunday')
  })

  it("reads a dated frame from its date's file, as one source labelled <date>:dated", () => {
    const datedWindow: ServiceWindow = {
      ...window,
      frames: [
        { date: '20261126', services: ['Sunday'], shiftS: -86400, dated: false },
        { date: '20261127', services: ['Weekday_C1', 'Weekday_C2'], shiftS: 0, dated: true },
      ],
    }
    const day = { ...file([]), date: '20261127', services: ['Weekday_C1', 'X1'] }
    // No file for Weekday_C1 or Weekday_C2 is needed: the date's file replaces them.
    expect(sourcesFor(datedWindow, new Map([['Sunday', sunday]]), new Map([['20261127', day]]))).toEqual([
      { label: '20261126:Sunday', shiftS: -86400, file: sunday },
      { label: '20261127:dated', shiftS: 0, file: day },
    ])
  })

  it('throws for a dated frame with no date file', () => {
    const datedWindow: ServiceWindow = { ...window, frames: [{ date: '20261127', services: ['Weekday'], shiftS: 0, dated: true }] }
    expect(() => sourcesFor(datedWindow, new Map([['Weekday', weekday]]))).toThrow('no dated timetable file for 20261127')
  })
})
