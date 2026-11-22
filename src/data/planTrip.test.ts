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

const datedTimetable = (date: string): TimetableFile => ({ ...timetable('Weekday_C1'), date, services: ['Weekday_C1', 'X1'] })

/** Serves the fixture calendar, empty transfers, a dated index listing `datedDates` and a timetable per service and
 *  per dated date; the first `failures` timetable fetches 500, and the dated index 500s `indexFailures` times. */
function stubFetch(failures = 0, datedDates: string[] = [], indexFailures = 0): { calls: string[] } {
  const calls: string[] = []
  let failed = 0
  let indexFailed = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      if (url.endsWith('data/timetable/dated/index.json')) {
        if (indexFailed < indexFailures) {
          indexFailed += 1
          return new Response('nope', { status: 500 })
        }
        return new Response(JSON.stringify({ format: 1, feedVersion: 'test', dates: datedDates }))
      }
      const datedOf = /data\/timetable\/dated\/(\d+)\.json$/.exec(url)?.[1]
      if (datedOf) return new Response(JSON.stringify(datedTimetable(datedOf)))
      const timetableOf = /data\/timetable\/(\w+)\.json$/.exec(url)?.[1]
      if (timetableOf) {
        if (failed < failures) {
          failed += 1
          return new Response('nope', { status: 500 })
        }
        return new Response(JSON.stringify(timetable(timetableOf)))
      }
      if (url.endsWith('data/route/transfers.json')) return new Response(JSON.stringify({ feedVersion: 'test', transfers: [] }))
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

  it("reads a date's dated file instead of its service files", async () => {
    const { calls } = stubFetch(0, ['20261123'])
    const { loadRouterTimetable } = await load()
    const built = await loadRouterTimetable(stations, MON_8)
    expect(built.window.frames).toEqual([{ date: '20261123', services: ['Weekday'], shiftS: 0, dated: true }])
    expect(fetched(calls, 'dated/20261123.json')).toBe(1)
    expect(calls.filter((u) => /timetable\/Weekday\.json$/.test(u))).toEqual([])
  })

  it('falls back to the service files when the index lists no date', async () => {
    const { calls } = stubFetch(0, [])
    const { loadRouterTimetable } = await load()
    await loadRouterTimetable(stations, MON_8)
    expect(fetched(calls, 'timetable/Weekday.json')).toBe(1)
    expect(calls.some((u) => u.includes('/dated/2'))).toBe(false)
  })

  it("mixes yesterday's service file with today's dated file", async () => {
    const { calls } = stubFetch(0, ['20261123'])
    const { loadRouterTimetable } = await load()
    const built = await loadRouterTimetable(stations, MON_2)
    expect(built.window.frames.map((f) => [f.date, f.dated])).toEqual([['20261122', false], ['20261123', true]])
    expect(fetched(calls, 'timetable/Sunday.json')).toBe(1)
    expect(fetched(calls, 'dated/20261123.json')).toBe(1)
    expect(calls.filter((u) => /timetable\/Weekday\.json$/.test(u))).toEqual([])
  })

  it('plans on a date only a dated file covers', async () => {
    stubFetch(0, ['20270601'])
    const { loadRouterTimetable } = await load()
    await expect(loadRouterTimetable(stations, PAST_CALENDAR)).resolves.toMatchObject({ window: { date: '20270601' } })
  })

  it('rejects when the dated index fails, and retries on the next call', async () => {
    const { calls } = stubFetch(0, [], 1)
    const { loadRouterTimetable } = await load()
    await expect(loadRouterTimetable(stations, MON_8)).rejects.toThrow('HTTP 500')
    await expect(loadRouterTimetable(stations, MON_8)).resolves.toMatchObject({ window: { date: '20261123' } })
    expect(fetched(calls, 'dated/index.json')).toBe(2)
  })

  it('throws NoServiceError when the calendar has no service that day', async () => {
    stubFetch()
    const { loadRouterTimetable, NoServiceError } = await load()
    const err = await loadRouterTimetable(stations, PAST_CALENDAR).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoServiceError)
    expect((err as InstanceType<typeof NoServiceError>).date).toBe('20270601')
  })
})
