/**
 * The join on the committed stations and the recorded alerts feed (worker/fixtures/alerts.json, through the Worker's own
 * transform). The acceptance case: 125 St (1), where the 1's skip alert is in effect.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformAlerts } from '../../../worker/src/alerts'
import { decodeShapePoints } from '../../data/codec'
import type { RoutesFile, ShapesFile } from '../../data/schema'
import { toGround } from '../projection'
import { realGroupById, realStations } from '../realGroups.testdata'
import { joinStationChanges, type StationChange } from './alertJoin'
import { skipSetsOf } from './alertStations'
import { serviceChangeView } from './alertText'
import { terminalsOf } from './routeTerminals'

const FEED = JSON.parse(readFileSync('worker/fixtures/alerts.json', 'utf8')) as unknown
/** The feed's own timestamp, a Monday evening. */
const FEED_AT = 1795465325
/** 2026-11-24 03:20 GMT, inside the overnight window of the R, 4/6, N and 5 alerts. */
const NIGHT = 1795500000
const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes
const routeOrder = new Map(routes.map((r, i) => [r.id, i]))
const routeById = new Map(routes.map((r) => [r.id, { id: r.id, shortName: r.shortName, longName: r.longName, color: r.color }]))
const stationById = new Map(realStations.map((s) => [s.id, s]))
const terminalOf = terminalsOf(
  (JSON.parse(readFileSync('public/data/shapes.json', 'utf8')) as ShapesFile).shapes.map((s) => ({
    routeId: s.routeId,
    direction: s.direction,
    primary: s.primary,
    points: decodeShapePoints(s).map((p) => toGround(p)),
  })),
  realStations,
)
/** 2026-12-02 05:00 GMT, inside the first period of the 4/6 "run express" alert. */
const EXPRESS_AT = 1796190000

/** The Worker's answer at `nowS` (it is polled then), joined at that moment. */
function joinAt(id: string, nowS: number) {
  const input = { configured: true, snapshot: transformAlerts(FEED, nowS).snapshot, failures: 0, schemaMismatch: false }
  return joinStationChanges(realGroupById.get(id)!, stationById, input, nowS, routeOrder, null)
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

  it('reads a header with no "skip" ("run express from A to B") by the probable rule, with the header\'s own stretch ends', () => {
    // Grand Central-42 St (631), where the express starts, is not informed; Brooklyn Bridge-City Hall (640) is, and stays quoted.
    expect(at('640', EXPRESS_AT, '36275')).toEqual(['36275 otherS 46 now'])
    for (const id of ['632', '633', '634', '636', '637', '638', '639']) expect(at(id, EXPRESS_AT, '36275'), id).toEqual(['36275 skippedS? 46 now'])
    // A probable skip is never in the heading's sentence.
    const group = realGroupById.get('637')!
    expect(serviceChangeView(joinAt('637', EXPRESS_AT), group, routeById, EXPRESS_AT, terminalOf).skipSpoken).toBe('')
    expect(group.borough).toBe('M')
  })

  it('reads "runs express from E 180 St to 3 Av-149 St": both ends quoted, the stations between probably skipped, 149 St-Hostos (listed, but beyond the end) only quoted', () => {
    const t = 1795625000
    for (const id of ['213', '221', '222']) expect(at(id, t, '35957'), id).toEqual(['35957 otherN 25 now'])
    for (const id of ['214', '215', '216', '217', '218', '219', '220']) expect(at(id, t, '35957'), id).toEqual(['35957 skippedN? 25 now'])
  })

  it('words the direction by terminal for the 7 and the L, and by uptown/downtown for the 1', () => {
    const words = (id: string, nowS: number) => {
      const v = serviceChangeView(joinAt(id, nowS), realGroupById.get(id)!, routeById, nowS, terminalOf)
      return v.body.kind === 'changes' ? v.body.rows.map((r) => r.parts[1]) : []
    }
    expect(words('713', FEED_AT)).toEqual(['Flushing-bound only'])
    expect(words('116', FEED_AT)).toEqual(['downtown only'])
    expect(serviceChangeView(joinAt('713', FEED_AT), realGroupById.get('713')!, routeById, FEED_AT, terminalOf).skipSpoken).toBe('The Flushing-bound 7 train skips this station now.')
  })

  it('makes the panel line and the spoken sentence', () => {
    const group = realGroupById.get('116')!
    const view = serviceChangeView(joinAt('116', FEED_AT), group, routeById, FEED_AT, terminalOf)
    expect(view.body).toMatchObject({ kind: 'changes' })
    if (view.body.kind !== 'changes') return
    expect(view.body.rows[0]!.parts.join(' · ')).toBe('skips this station · downtown only · until Fri 11:45 PM')
    expect(view.body.rows[0]!.header).toBe('Downtown [1] skips 125 St')
    expect(view.skipSpoken).toBe('The downtown 1 train skips this station now.')
  })
})
