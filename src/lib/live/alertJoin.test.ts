import { describe, expect, it } from 'vitest'
import type { AlertEntity, AlertPeriod, AlertsSnapshot, ServiceAlert } from '../../data/realtime'
import type { Station } from '../network'
import type { StationGroup } from '../stationGroups'
import { ALERTS_MAX_AGE_S, joinStationChanges, type AlertsInput, type StationChange } from './alertJoin'

const NOW = 1_000_000
const DAY = 86_400

const station = (id: string, name: string, x: number, routeIds: string[] = ['1']): Station => ({
  id,
  name,
  pos: { x, z: 0 },
  routeIds,
  stops: [`${id}N`, `${id}S`],
  access: { status: 'none' },
  leadId: id,
})
const STATIONS = [
  station('a', 'Alpha St', 0),
  station('b', 'Beta St', 100),
  station('c', 'Gamma St', 200),
  station('d', 'Delta St', 300),
  station('e', 'Epsilon St', 400),
  station('x', 'Seven Av', 500, ['7']),
  station('y', 'Other Plaza', 600, ['2']),
]
const stationById = new Map(STATIONS.map((s) => [s.id, s]))
const group = (id: string, memberIds: string[] = [id]): StationGroup => {
  const s = stationById.get(id)!
  return { ...s, routeIds: [...new Set(memberIds.flatMap((m) => stationById.get(m)!.routeIds))], memberIds, otherNames: [] }
}
const ORDER = new Map([['1', 0], ['2', 1], ['7', 2], ['7X', 3]])

const stop = (route: string, id: string, direction: AlertEntity['direction'] = null): AlertEntity => ({ route, stop: id, direction })
const alert = (over: Partial<ServiceAlert> = {}): ServiceAlert => ({
  id: 'lmm:planned_work:1',
  type: 'Planned - Stops Skipped',
  header: 'Downtown [1] skips Beta St',
  periods: [[NOW - 100, NOW + 1000]],
  entities: [stop('1', 'a', 'S'), stop('1', 'b', 'S'), stop('1', 'c', 'S')],
  ...over,
})
const feed = (alerts: ServiceAlert[], over: Partial<AlertsInput> = {}, generatedAt = NOW - 10): AlertsInput => ({
  configured: true,
  snapshot: { version: 1, generatedAt, dropped: 0, alerts } satisfies AlertsSnapshot,
  failures: 0,
  schemaMismatch: false,
  ...over,
})
const join = (id: string, alerts: ServiceAlert[], nowS = NOW, members?: string[]) => joinStationChanges(group(id, members), stationById, feed(alerts), nowS, ORDER, null)
const changes = (id: string, alerts: ServiceAlert[], nowS = NOW, members?: string[]): StationChange[] => {
  const { panel } = join(id, alerts, nowS, members)
  return panel.kind === 'changes' ? panel.changes : []
}
const brief = (c: StationChange) => `${c.kind}${c.direction ?? ''}${c.probable ? '?' : ''}:${c.routes.join('')}`

describe('skip alerts', () => {
  it('skipped at the station the header names, other at the informed ones it does not', () => {
    expect(changes('b', [alert()]).map(brief)).toEqual(['skippedS:1'])
    expect(changes('a', [alert()]).map(brief)).toEqual(['otherS:1'])
    expect(changes('d', [alert()])).toEqual([])
  })

  it('is probably skipped, by the stretch minus its ends, when the header names none of the informed stops', () => {
    const guess = alert({ header: 'Downtown [1] trains skip stops' })
    expect(changes('b', [guess]).map(brief)).toEqual(['skippedS?:1'])
    expect(changes('a', [guess]).map(brief)).toEqual(['otherS:1'])
  })

  it('is probably skipped at every informed station when there are two or fewer', () => {
    const two = alert({ header: 'Express', entities: [stop('1', 'a'), stop('1', 'b')] })
    expect(changes('a', [two]).map(brief)).toEqual(['skipped?:1'])
    expect(changes('b', [two]).map(brief)).toEqual(['skipped?:1'])
  })

  it('carries the verbatim header and the end of the period in effect', () => {
    const [c] = changes('b', [alert({ header: 'Downtown [1] skips Beta St\nsecond line ' })])
    expect(c).toMatchObject({ now: true, from: null, until: NOW + 1000, header: 'Downtown [1] skips Beta St\nsecond line ' })
  })
})

describe('part suspended', () => {
  const part = (entities: AlertEntity[]) => alert({ type: 'Planned - Part Suspended', header: 'No [1] between Alpha St and Epsilon St', entities })
  const stretch = ['a', 'b', 'c', 'd', 'e'].map((id) => stop('1', id))

  it('suspends the stops inside the stretch and leaves its ends to the header', () => {
    expect(changes('c', [part(stretch)]).map(brief)).toEqual(['suspended:1'])
    expect(changes('b', [part(stretch)]).map(brief)).toEqual(['suspended:1'])
    expect(changes('a', [part(stretch)]).map(brief)).toEqual(['other:1'])
    expect(changes('e', [part(stretch)]).map(brief)).toEqual(['other:1'])
  })

  it('takes the ends as the farthest pair, whatever the order of the list', () => {
    const shuffled = ['c', 'e', 'a', 'd', 'b'].map((id) => stop('1', id))
    expect(changes('a', [part(shuffled)]).map(brief)).toEqual(['other:1'])
    expect(changes('d', [part(shuffled)]).map(brief)).toEqual(['suspended:1'])
  })

  it('suspends the one informed station; with two informed, neither (both are ends)', () => {
    expect(changes('b', [part([stop('1', 'b')])]).map(brief)).toEqual(['suspended:1'])
    expect(changes('b', [part([stop('1', 'a'), stop('1', 'b')])]).map(brief)).toEqual(['other:1'])
  })
})

describe('suspended and other alerts', () => {
  it('a suspension suspends every informed stop and a whole-route entity reaches the whole line', () => {
    const stops = alert({ type: 'Planned - Suspended', header: 'No overnight [1]', entities: [stop('1', 'a'), stop('1', 'e')] })
    expect(changes('a', [stops]).map(brief)).toEqual(['suspended:1'])
    expect(changes('c', [stops])).toEqual([])
    const route = alert({ type: 'Planned - Suspended', entities: [{ route: '1', stop: null, direction: null }] })
    expect(changes('c', [route]).map(brief)).toEqual(['suspended:1'])
  })

  it('lists any other type as other, with its routes in route order in one row', () => {
    const delays = alert({ type: 'Delays', header: 'Delays', entities: [{ route: '2', stop: null, direction: null }, { route: '1', stop: null, direction: null }] })
    const station12 = [station('p', 'Pi St', 0, ['2', '1'])]
    const byId = new Map([...STATIONS, ...station12].map((s) => [s.id, s]))
    const g = { ...station12[0]!, memberIds: ['p'], otherNames: [] }
    const { panel } = joinStationChanges(g, byId, feed([delays]), NOW, ORDER, null)
    expect(panel.kind === 'changes' && panel.changes.map(brief)).toEqual(['other:12'])
  })

  it('a whole-route entity of an express reaches the local line (7X reaches the 7)', () => {
    const express = alert({ type: 'Delays', entities: [{ route: '7X', stop: null, direction: null }] })
    expect(changes('x', [express]).map(brief)).toEqual(['other:7X'])
    expect(changes('y', [express])).toEqual([])
  })
})

describe('route-wide changes', () => {
  const wide = (over: Partial<ServiceAlert> = {}) => alert({ id: 'w', type: 'Delays', header: 'Delays', entities: [{ route: '1', stop: null, direction: null }], ...over })

  it('are marked route-wide, carry the type, and come after the changes about this station, even when both are in effect', () => {
    const list = changes('b', [wide(), alert({ id: 'z' })])
    expect(list.map((c) => [c.alertId, c.routeWide, c.type])).toEqual([['z', false, 'Planned - Stops Skipped'], ['w', true, 'Delays']])
  })

  it('a route-wide change in effect still comes before one that has not started, within each group', () => {
    const later = wide({ id: 'w2', periods: [[NOW + 100, NOW + 900]] })
    expect(changes('b', [later, wide()]).map((c) => c.alertId)).toEqual(['w', 'w2'])
  })

  it('a route-wide suspension is exact: a 6X-only suspension is not "no service here" at a 6 station', () => {
    const six = [station('s6', 'Six St', 0, ['6'])]
    const byId = new Map([...STATIONS, ...six].map((s) => [s.id, s]))
    const g = { ...six[0]!, memberIds: ['s6'], otherNames: [] }
    const suspended = (route: string) => alert({ type: 'Planned - Suspended', header: 'No service', entities: [{ route, stop: null, direction: null }] })
    const run = (a: ServiceAlert) => joinStationChanges(g, byId, feed([a]), NOW, ORDER, null).panel
    expect(run(suspended('6X'))).toEqual({ kind: 'none' })
    expect(run(suspended('6'))).toMatchObject({ kind: 'changes', changes: [{ kind: 'suspended' }] })
    // Delays on the 6X, by contrast, do reach the 6 (an express is folded into its line).
    expect(run(alert({ type: 'Delays', entities: [{ route: '6X', stop: null, direction: null }] }))).toMatchObject({ kind: 'changes' })
  })
})

describe('direction', () => {
  const delays = (entities: AlertEntity[]) => alert({ type: 'Station Notice', entities })

  it('is one direction when every entity at the station shares it, else both', () => {
    expect(changes('a', [delays([stop('1', 'a', 'N')])]).map(brief)).toEqual(['otherN:1'])
    expect(changes('a', [delays([stop('1', 'a', 'S')])]).map(brief)).toEqual(['otherS:1'])
    expect(changes('a', [delays([stop('1', 'a', 'N'), stop('1', 'a', 'S')])]).map(brief)).toEqual(['other:1'])
    expect(changes('a', [delays([stop('1', 'a', null)])]).map(brief)).toEqual(['other:1'])
  })

  it('a skip of one direction is that direction; mixed stops give both', () => {
    expect(changes('b', [alert({ entities: [stop('1', 'a', 'N'), stop('1', 'b', 'N')] })]).map(brief)).toEqual(['skippedN:1'])
    expect(changes('b', [alert({ entities: [stop('1', 'a', 'N'), stop('1', 'b', 'S')] })]).map(brief)).toEqual(['skipped:1'])
  })
})

describe('complexes', () => {
  it('a stop of any member reaches the group, and a member named by the header is skipped', () => {
    const skip = alert({ header: 'Downtown [1] skips Delta St', entities: [stop('1', 'c'), stop('1', 'd'), stop('1', 'e')] })
    expect(changes('c', [skip], NOW, ['c', 'd']).map(brief)).toEqual(['skipped:1'])
    expect(changes('c', [skip]).map(brief)).toEqual(['other:1'])
  })
})

describe('periods', () => {
  it('drops an alert that ended, one starting beyond a day, and keeps one starting later as "from"', () => {
    expect(changes('b', [alert({ periods: [[NOW - 500, NOW - 1]] })])).toEqual([])
    expect(changes('b', [alert({ periods: [[NOW + DAY, NOW + DAY + 100]] })])).toEqual([])
    const [later] = changes('b', [alert({ periods: [[NOW + 5000, NOW + 9000]] })])
    expect(later).toMatchObject({ now: false, from: NOW + 5000, until: null })
  })

  it('an alert whose period ends between polls goes at once, though the snapshot still has it', () => {
    const a = alert({ periods: [[NOW - 500, NOW + 100]] })
    expect(changes('b', [a], NOW)).toHaveLength(1)
    expect(changes('b', [a], NOW + 100)).toEqual([])
  })

  it('takes the period in effect over a later one, and the nearest later one otherwise', () => {
    const periods: AlertPeriod[] = [[NOW + 9000, NOW + 9500], [NOW - 10, NOW + 50], [NOW + 5000, NOW + 6000]]
    expect(changes('b', [alert({ periods })])[0]).toMatchObject({ now: true, until: NOW + 50 })
    const ahead = alert({ periods: [periods[0]!, periods[2]!] })
    expect(changes('b', [ahead])[0]).toMatchObject({ now: false, from: NOW + 5000 })
  })

  it('an open-ended alert in effect has no end, and one with no start has no "from"', () => {
    expect(changes('b', [alert({ periods: [[0, null]] })])[0]).toMatchObject({ now: true, until: null, from: null })
  })
})

describe('order', () => {
  it('lists changes in effect first, then skipped, suspended, other', () => {
    const skip = alert({ id: 's' })
    const note = alert({ id: 'n', type: 'Station Notice', entities: [stop('1', 'b')] })
    const sus = alert({ id: 'u', type: 'Planned - Suspended', entities: [stop('1', 'b')] })
    const soon = alert({ id: 'f', periods: [[NOW + 100, NOW + 900]] })
    expect(changes('b', [note, soon, sus, skip]).map((c) => c.alertId)).toEqual(['s', 'u', 'n', 'f'])
  })
})

describe('freshness', () => {
  const run = (input: AlertsInput) => joinStationChanges(group('b'), stationById, input, NOW, ORDER, null)

  it('says nothing without a Worker, and while still connecting', () => {
    expect(run({ configured: false, snapshot: null, failures: 0, schemaMismatch: false })).toEqual({ panel: { kind: 'none' }, known: false })
    expect(run({ configured: true, snapshot: null, failures: 1, schemaMismatch: false }).panel.kind).toBe('none')
  })

  it('is unknown, never "no changes", after two failures with nothing, a mismatch, or an old snapshot', () => {
    expect(run({ configured: true, snapshot: null, failures: 2, schemaMismatch: false })).toEqual({ panel: { kind: 'unknown' }, known: false })
    expect(run(feed([alert()], { schemaMismatch: true })).panel.kind).toBe('unknown')
    expect(run(feed([alert()], {}, NOW - ALERTS_MAX_AGE_S - 1)).panel.kind).toBe('unknown')
    expect(run(feed([alert()], { failures: 5 }, NOW - ALERTS_MAX_AGE_S - 1)).known).toBe(false)
  })

  it('is known with nothing to show when the snapshot is fresh and has nothing here', () => {
    expect(run(feed([]))).toEqual({ panel: { kind: 'none' }, known: true })
    expect(run(feed([alert()], {}, NOW - ALERTS_MAX_AGE_S)).known).toBe(true)
  })
})
