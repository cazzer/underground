import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StationsFile, TransfersFile } from '../../data/schema'
import type { TimetableFile } from '../../data/timetableSchema'
import { route } from './raptor'
import { buildRouterTimetable, type TimetableSource } from './timetable'
import type { Journey, RideLeg, Timetable } from './types'

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const stations = read<StationsFile>('stations.json')
const transfers = read<TransfersFile>('route/transfers.json').transfers
const files = {
  Weekday: read<TimetableFile>('timetable/Weekday.json'),
  Saturday: read<TimetableFile>('timetable/Saturday.json'),
  Sunday: read<TimetableFile>('timetable/Sunday.json'),
}
const src = (id: keyof typeof files, shiftS = 0): TimetableSource => ({ label: `${id}`, shiftS, file: files[id] })

const rides = (j: Journey): RideLeg[] => j.legs.filter((l): l is RideLeg => l.kind === 'ride')
const stationOf = (stop: string): string => stop.slice(0, -1)

describe('real committed timetables', { timeout: 60_000 }, () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const built = new Map<string, Timetable>()
  beforeAll(() => {
    for (const id of Object.keys(files) as (keyof typeof files)[]) built.set(id, buildRouterTimetable([src(id)], stations, transfers))
  })
  afterAll(() => warn.mockRestore())

  it.each(['Weekday', 'Saturday', 'Sunday'] as const)('%s keeps every pattern and trip, with no warning', (id) => {
    const tt = built.get(id)!
    expect(tt.patterns).toHaveLength(files[id].patterns.length)
    const trips = files[id].patterns.reduce((n, p) => n + p.trips.length, 0)
    expect(tt.patterns.reduce((n, p) => n + p.tripIds.length, 0)).toBe(trips)
    expect(warn).not.toHaveBeenCalled()
  })

  it('rides the L from Bedford Av to 6 Av on a weekday morning', () => {
    const [journey] = route(built.get('Weekday')!, ['L08'], ['L06'], 28800)
    expect(journey).toBeDefined()
    expect(journey!.transfers).toBe(0)
    const [ride, ...rest] = rides(journey!)
    expect(rest).toEqual([])
    expect(ride).toMatchObject({ routeId: 'L', boardStop: 'L08N', alightStop: 'L06N' })
    expect(ride!.departS).toBeGreaterThanOrEqual(28800)
    expect(ride!.departS).toBeLessThanOrEqual(29400)
    expect(ride!.arriveS - ride!.departS).toBeGreaterThanOrEqual(120)
    expect(ride!.arriveS - ride!.departS).toBeLessThanOrEqual(420)
  })

  it('reaches Times Sq-42 St (127) from Bedford Av with a change inside the hour', () => {
    const journeys = route(built.get('Weekday')!, ['L08'], ['127'], 28800)
    const changed = journeys.find((j) => j.transfers >= 1 && j.arriveS < 28800 + 3600)
    expect(changed).toBeDefined()
    const last = changed!.legs[changed!.legs.length - 1]!
    expect(stationOf(last.kind === 'ride' ? last.alightStop : last.toStop)).toBe('127')
  })

  it("boards yesterday's past-midnight trips when its file is shifted back a day", () => {
    const both = buildRouterTimetable([src('Saturday', -86400), src('Sunday')], stations, transfers)
    const sundayOnly = built.get('Sunday')!
    const [early] = route(both, ['L08'], ['L06'], 0)
    const [late] = route(sundayOnly, ['L08'], ['L06'], 0)
    const first = rides(early!)[0]!
    expect(first.tripId.startsWith('Saturday/')).toBe(true)
    expect(first.departS).toBeLessThan(rides(late!)[0]!.departS)
  })

  it('takes the shortest change time from the files as the own-station footpath', () => {
    const rows = files.Weekday.changes
    const row = rows.reduce((best, c) => (c.minTransferSec < best.minTransferSec ? c : best))
    const tt = built.get('Weekday')!
    const { stopOf, footStart, footTo, footS } = tt.stops
    const p = stopOf.get(`${row.station}N`)!
    const q = stopOf.get(`${row.station}S`)!
    let found: number | undefined
    for (let i = footStart[p]!; i < footStart[p + 1]!; i++) if (footTo[i] === q) found = footS[i]
    expect(found).toBe(row.minTransferSec)
  })
})
