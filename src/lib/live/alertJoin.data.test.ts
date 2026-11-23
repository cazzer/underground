/**
 * The join on the committed stations and the recorded alerts feed (worker/fixtures/alerts.json, through the Worker's own
 * transform). The acceptance case: 125 St (1), where the 1's skip alert is in effect.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformAlerts } from '../../../worker/src/alerts'
import type { RoutesFile } from '../../data/schema'
import { realGroupById, realStations } from '../realGroups.testdata'
import { joinStationChanges, type StationChange } from './alertJoin'
import { skipSetsOf } from './alertStations'
import { serviceChangeView } from './alertText'

const FEED = JSON.parse(readFileSync('worker/fixtures/alerts.json', 'utf8')) as unknown
/** The feed's own timestamp, a Monday evening. */
const FEED_AT = 1795465325
/** 2026-11-24 03:20 GMT, inside the overnight window of the R, 4/6, N and 5 alerts. */
const NIGHT = 1795500000
const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes
const routeOrder = new Map(routes.map((r, i) => [r.id, i]))
const routeById = new Map(routes.map((r) => [r.id, { id: r.id, shortName: r.shortName, longName: r.longName, color: r.color }]))
const stationById = new Map(realStations.map((s) => [s.id, s]))

/** The Worker's answer at `nowS` (it is polled then), joined at that moment. */
function joinAt(id: string, nowS: number) {
  const input = { configured: true, snapshot: transformAlerts(FEED, nowS).snapshot, failures: 0, schemaMismatch: false }
  return joinStationChanges(realGroupById.get(id)!, stationById, input, nowS, routeOrder)
}
const changesAt = (id: string, nowS: number): StationChange[] => {
  const { panel } = joinAt(id, nowS)
  return panel.kind === 'changes' ? panel.changes : []
}
const summary = (c: StationChange) => `${c.alertId.replace('lmm:planned_work:', '')} ${c.kind}${c.direction ?? ''}${c.probable ? '?' : ''} ${c.routes.join('')} ${c.now ? 'now' : 'later'}`
const at = (id: string, nowS: number, alert: string) => changesAt(id, nowS).filter((c) => c.alertId.endsWith(`:${alert}`)).map(summary)

describe('skipSetsOf on the recorded alerts', () => {
  const alerts = new Map(transformAlerts(FEED, NIGHT).snapshot.alerts.map((a) => [a.id, a]))
  const sets = (id: string) => skipSetsOf(alerts.get(`lmm:planned_work:${id}`)!, stationById)

  it('reads the header: 125 St alone for the 1', () => {
    expect(sets('35124')).toHaveLength(1)
    expect(sets('35124')[0]).toMatchObject({ route: '1', direction: 'S', probable: false })
    expect([...sets('35124')[0]!.stations]).toEqual(['116'])
  })

  it('has no set for a part-suspension or a notice', () => {
    expect(sets('35962')).toEqual([])
    expect(skipSetsOf(alerts.get('lmm:planned_work:33366')!, stationById)).toEqual([])
  })

  it('names the 4/6 stations from the header and leaves 86 St and 59 St out, though informed', () => {
    const [four, six] = sets('35976')
    expect(four).toMatchObject({ route: '4', direction: 'S', probable: false })
    expect(six).toMatchObject({ route: '6' })
    expect([...four!.stations].sort()).toEqual(['622', '623', '624', '625', '627', '628', '630'])
  })
})

describe('joinStationChanges on the recorded feed', () => {
  it('125 St (1): one skip, southbound, not a guess, until its period ends', () => {
    const changes = changesAt('116', FEED_AT)
    expect(changes.map(summary)).toEqual(['35124 skippedS 1 now'])
    expect(changes[0]).toMatchObject({ probable: false, until: 1795841100, header: 'Downtown [1] skips 125 St' })
  })

  it('a stop the 1 alert lists but the header does not name only quotes it', () => {
    expect(changesAt('117', FEED_AT).map(summary)).toEqual(['35124 otherS 1 now'])
  })

  it('reads the R skip: named stops skipped northbound, the stretch ends quoted', () => {
    expect(at('R35', NIGHT, '35972')).toEqual(['35972 skippedN R now'])
    expect(at('R36', NIGHT, '35972')).toEqual(['35972 otherN R now'])
    expect(at('R31', NIGHT, '35972')).toEqual(['35972 otherN R now'])
  })

  it('reads the 4/6 skip: 68 St by its part, 86 St quoted', () => {
    expect(at('628', NIGHT, '35976')).toEqual(['35976 skippedS 46 now'])
    expect(at('626', NIGHT, '35976')).toEqual(['35976 otherS 46 now'])
  })

  it('reads the N part-suspension: inside the stretch suspended, the ends quoted', () => {
    expect(at('R14', NIGHT, '35962')).toEqual(['35962 suspended N now'])
    expect(at('R09', NIGHT, '35962')).toEqual(['35962 other N now'])
  })

  it('reads a skip whose header has a second line naming a station: 52 St and 69 St skipped, Woodside only quoted', () => {
    expect(at('713', FEED_AT, '31498')).toEqual(['31498 skippedN 7 now'])
    expect(at('711', FEED_AT, '31498')).toEqual(['31498 skippedN 7 now'])
    expect(at('712', FEED_AT, '31498')).toEqual(['31498 otherN 7 now'])
    expect(at('714', FEED_AT, '31498')).toEqual([])
  })

  it('shows a whole-route delay at every station of its lines, with both routes in one row', () => {
    for (const id of ['D14', 'D13', 'A32', '637']) {
      expect(changesAt(id, FEED_AT).map(summary)).toEqual(['lmm:alert:277657:26 other BD now'])
    }
    expect(changesAt('L08', FEED_AT)).toEqual([])
  })

  it('answers a complex for any member: 59 St has the N suspended through its N/R/W member and the 4/6 quoted', () => {
    const group = realGroupById.get('629')!
    expect(group.memberIds).toContain('R11')
    expect(changesAt('629', NIGHT).map(summary)).toEqual(['35962 suspended N now', '35976 otherS 46 now'])
  })

  it('makes the panel line and the spoken sentence', () => {
    const group = realGroupById.get('116')!
    const view = serviceChangeView(joinAt('116', FEED_AT), group, routeById, FEED_AT)
    expect(view.body).toMatchObject({ kind: 'changes' })
    if (view.body.kind !== 'changes') return
    expect(view.body.rows[0]!.parts.join(' · ')).toBe('skips this station · downtown only · until Fri 11:45 PM')
    expect(view.body.rows[0]!.header).toBe('Downtown [1] skips 125 St')
    expect(view.skipSpoken).toBe('Downtown 1 trains skip this station now.')
  })
})
