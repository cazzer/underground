/**
 * The skip lookups on the committed stations and the recorded alerts feed (worker/fixtures/alerts.json, through the
 * Worker's own transform): the acceptance cases, and agreement with the station panel's join.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformAlerts } from '../../../worker/src/alerts'
import type { RoutesFile } from '../../data/schema'
import { realGroups, realGroupById, realStations } from '../realGroups.testdata'
import { joinStationChanges } from './alertJoin'
import { alertSkipsOf, markSkips, skipAt, skipStopText, trainLine } from './alertSkips'
import { lineKey } from './lineFilter'
import type { TrainStop } from './trainStops'

const FEED = JSON.parse(readFileSync('worker/fixtures/alerts.json', 'utf8')) as unknown
const FEED_AT = 1795465325
/** 2026-11-24 03:20 GMT, inside the overnight window of the R, 4/6, N and 5 alerts. */
const NIGHT = 1795500000
/** After the 1's skip period ends (until 1795841100). */
const AFTER = 1795841100
const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes
const routeOrder = new Map(routes.map((r, i) => [r.id, i]))
const stationById = new Map(realStations.map((s) => [s.id, s]))
const skipsAt = (nowS: number) => alertSkipsOf(transformAlerts(FEED, nowS).snapshot, false, stationById)

describe('a downtown 1 train through 125 St (the acceptance case)', () => {
  const stops: TrainStop[] = ['115S', '116S', '117S'].map((stopId, i) => ({ stopId, name: stationById.get(stopId.slice(0, -1))!.name, time: FEED_AT + 60 * (i + 1), standing: false }))
  const train = (direction: 'N' | 'S') => ({
    shapeId: '1..S03R',
    trip: { route: '1', direction, arrivals: [] },
  })
  const marksFor = (direction: 'N' | 'S', nowS: number) => {
    const patterns = { '1..S03R': { routeId: '1', direction, stops: [] } }
    const { route, direction: dir } = trainLine(train(direction) as unknown as Parameters<typeof trainLine>[0], new Map([['1', 1]]), patterns)
    const skips = skipsAt(nowS)
    return markSkips(stops, (id) => skipAt(skips, route!, dir, [id], nowS))
  }

  it('strikes only 125 St, with the spoken sentence', () => {
    const marked = marksFor('S', FEED_AT)
    expect(marked.map((s) => s.skip)).toEqual([null, 'skips', null])
    expect(marked[1]!.name).toBe('125 St')
    expect(skipStopText(marked[1]!.name, marked[1]!.skip!).spoken).toBe('skips 125 St, per MTA notice')
  })

  it('leaves an uptown 1 alone, and the downtown one once the period has ended', () => {
    expect(marksFor('N', FEED_AT).map((s) => s.skip)).toEqual([null, null, null])
    expect(marksFor('S', AFTER).map((s) => s.skip)).toEqual([null, null, null])
  })
})

describe('125 St arrivals', () => {
  const ids = realGroupById.get('116')!.memberIds
  it('skips for the downtown 1 only', () => {
    const skips = skipsAt(FEED_AT)
    expect(skipAt(skips, '1', 'S', ids, FEED_AT)).toBe('skips')
    expect(skipAt(skips, '1', 'N', ids, FEED_AT)).toBeNull()
    expect(skipAt(skips, '2', 'S', ids, FEED_AT)).toBeNull()
  })
})

describe('the R at night', () => {
  const skips = skipsAt(NIGHT)
  it('skips R35 northbound only, and not its neighbours', () => {
    expect(skipAt(skips, 'R', 'N', ['R35'], NIGHT)).toBe('skips')
    expect(skipAt(skips, 'R', 'S', ['R35'], NIGHT)).toBeNull()
    expect(skipAt(skips, 'R', 'N', ['R36'], NIGHT)).toBeNull()
    expect(skipAt(skips, 'R', 'N', ['R31'], NIGHT)).toBeNull()
  })
})

describe('agreement with the station panel', () => {
  it('every group and route: a skip in effect there, in a direction, is a change row that is skipped, and the reverse', () => {
    for (const at of [FEED_AT, NIGHT]) {
      const snapshot = transformAlerts(FEED, at).snapshot
      const skips = alertSkipsOf(snapshot, false, stationById)
      const input = { configured: true, snapshot, failures: 0, schemaMismatch: false }
      const wrong: string[] = []
      for (const group of realGroups) {
        const panel = joinStationChanges(group, stationById, input, at, routeOrder, null).panel
        const rows = panel.kind === 'changes' ? panel.changes.filter((c) => c.kind === 'skipped' && c.now) : []
        // An express (7X) is covered by its line's alert here and not in the panel's rows, so only own-line routes compare.
        for (const route of group.routeIds.filter((r) => lineKey(r) === r)) {
          const dirs = (['N', 'S'] as const).filter((d) => skipAt(skips, route, d, group.memberIds, at) !== null)
          const rowDirs = rows
            .filter((c) => c.routes.includes(route))
            .flatMap((c) => (c.direction === null ? (['N', 'S'] as const) : [c.direction]))
          if (dirs.join() !== [...new Set(rowDirs)].sort().join()) wrong.push(`${at} ${group.id} ${route}: ${dirs} vs ${rowDirs}`)
        }
      }
      expect(wrong).toEqual([])
    }
  })
})
