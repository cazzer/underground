import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { index, stations } from '../lib/realtime/fixture'
import type { TimetableFile } from './timetableSchema'

const at = (...utc: [number, number, number, number, number?]) => Date.UTC(utc[0], utc[1], utc[2], utc[3], utc[4] ?? 0) / 1000
const MON_8 = at(2026, 10, 23, 13)
const MON_9 = at(2026, 10, 23, 14)
const MON_2 = at(2026, 10, 23, 7) // 02:00 EST: Sunday's frame joins
const PAST_CALENDAR = at(2027, 5, 1, 16)

const timetable = (service: string): TimetableFile => ({
  format: 1,
  feedVersion: 'test',
  services: [service],
  changes: [],
  patterns: [{ routeId: 'W', direction: 'N', stops: ['101N', '102N', '103N'], trips: [[960, [4, 4]]] }],
})

/** Serves the fixture calendar, empty transfers and a timetable per service; the first `failures` timetable fetches 500. */
function stubFetch(failures = 0): { calls: string[] } {
  const calls: string[] = []
  let failed = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const timetableOf = /data\/timetable\/(\w+)\.json$/.exec(url)?.[1]
      if (timetableOf) {
        if (failed < failures) {
          failed += 1
          return new Response('nope', { status: 500 })
        }
        return new Response(JSON.stringify(timetable(timetableOf)))
      }
      if (url.endsWith('data/transfers.json')) return new Response(JSON.stringify({ feedVersion: 'test', transfers: [] }))
      if (url.endsWith('data/trip-index.json')) return new Response(JSON.stringify(index))
      return new Response('?', { status: 404 })
    }),
  )
  return { calls }
}
const fetched = (calls: string[], name: string) => calls.filter((u) => u.endsWith(name)).length

// planTrip keeps a module-level cache, so each test gets a fresh module.
async function load() {
  vi.resetModules()
  return import('./planTrip')
}

describe('planTrip', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('plans a journey in epoch seconds', async () => {
    stubFetch()
    const { planTrip } = await load()
    const [journey] = await planTrip(stations, ['101'], ['103'], MON_8)
    expect(journey).toMatchObject({ departAt: at(2026, 10, 23, 5) + 28800, transfers: 0 })
    expect(journey!.legs[0]).toMatchObject({ kind: 'ride', tripId: '20261123:Weekday/0/0' })
  })

  it('reuses the built timetable for the same window', async () => {
    const { calls } = stubFetch()
    const { loadRouterTimetable } = await load()
    const first = await loadRouterTimetable(stations, MON_8)
    const second = await loadRouterTimetable(stations, MON_9)
    expect(second).toBe(first)
    expect(fetched(calls, 'Weekday.json')).toBe(1)
  })

  it('rebuilds for a new window', async () => {
    const { calls } = stubFetch()
    const { loadRouterTimetable } = await load()
    const first = await loadRouterTimetable(stations, MON_8)
    const second = await loadRouterTimetable(stations, MON_2)
    expect(second).not.toBe(first)
    expect(second.window.frames.map((f) => f.services)).toEqual([['Sunday'], ['Weekday']])
    expect(fetched(calls, 'Weekday.json')).toBe(1)
    expect(fetched(calls, 'Sunday.json')).toBe(1)
  })

  it('forgets a failed load, so the next call refetches', async () => {
    const { calls } = stubFetch(1)
    const { loadRouterTimetable } = await load()
    await expect(loadRouterTimetable(stations, MON_8)).rejects.toThrow('HTTP 500')
    await expect(loadRouterTimetable(stations, MON_8)).resolves.toMatchObject({ window: { date: '20261123' } })
    expect(fetched(calls, 'Weekday.json')).toBe(2)
  })

  it('throws NoServiceError when the calendar has no service that day', async () => {
    stubFetch()
    const { loadRouterTimetable, NoServiceError } = await load()
    const err = await loadRouterTimetable(stations, PAST_CALENDAR).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoServiceError)
    expect((err as InstanceType<typeof NoServiceError>).date).toBe('20270601')
  })
})
