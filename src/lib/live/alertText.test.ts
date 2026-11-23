import { describe, expect, it } from 'vitest'
import type { Route } from '../network'
import type { StationGroup } from '../stationGroups'
import type { ChangesJoin, StationChange } from './alertJoin'
import { serviceChangeView, UNKNOWN_TEXT } from './alertText'

// 2026-11-23 15:22 New York (Monday).
const NOW = 1795465325
const route = (id: string, shortName = id): [string, Route] => [id, { id, shortName, longName: id, color: '#000000' }]
const routeById = new Map([route('1'), route('2'), route('A'), route('C'), route('E'), route('7X', '7X')])
const group = (borough: 'M' | 'Bk'): StationGroup => ({
  id: 'g',
  name: 'G St',
  pos: { x: 0, z: 0 },
  routeIds: ['1'],
  stops: [],
  borough,
  access: { status: 'none' },
  leadId: 'g',
  memberIds: ['g'],
  otherNames: [],
})
const change = (over: Partial<StationChange> = {}): StationChange => ({
  alertId: 'lmm:planned_work:1',
  kind: 'skipped',
  routes: ['1'],
  direction: 'S',
  probable: false,
  now: true,
  from: null,
  until: NOW + 3600 * 5,
  header: 'Downtown [1] skips G St',
  ...over,
})
const join = (...changes: StationChange[]): ChangesJoin => ({ panel: { kind: 'changes', changes }, known: true })
const rows = (j: ChangesJoin, borough: 'M' | 'Bk' = 'M') => {
  const view = serviceChangeView(j, group(borough), routeById, NOW)
  return view.body.kind === 'changes' ? view.body.rows : []
}

describe('serviceChangeView rows', () => {
  it('skips: our line (kept whole) with the direction word by borough, over the verbatim header', () => {
    expect(rows(join(change()))[0]).toMatchObject({ parts: ['skips this station', 'downtown only', 'until 8:22 PM'], header: 'Downtown [1] skips G St' })
    expect(rows(join(change()), 'Bk')[0]!.parts).toEqual(['skips this station', 'southbound only', 'until 8:22 PM'])
    expect(rows(join(change({ direction: 'N' })))[0]!.parts[1]).toBe('uptown only')
    expect(rows(join(change({ direction: 'N' })), 'Bk')[0]!.parts[1]).toBe('northbound only')
  })

  it('says probably for a guess, and words suspensions and other changes', () => {
    expect(rows(join(change({ probable: true, direction: null })))[0]!.parts[0]).toBe('probably skips this station')
    expect(rows(join(change({ kind: 'suspended', direction: null })))[0]!.parts[0]).toBe('no service here')
    expect(rows(join(change({ kind: 'other', direction: null })))[0]!.parts[0]).toBe('service change')
  })

  it('times: until for one in effect, from for one to come, nothing when open-ended or unbounded', () => {
    expect(rows(join(change({ until: null, direction: null })))[0]!.parts).toEqual(['skips this station'])
    expect(rows(join(change({ now: false, from: NOW + 7200, until: null, direction: null })))[0]!.parts).toEqual(['skips this station', 'from 5:22 PM'])
    expect(rows(join(change({ now: false, from: null, until: null, direction: null })))[0]!.parts).toEqual(['skips this station'])
  })

  it('keeps the header byte for byte', () => {
    const header = '  odd \n header  '
    expect(rows(join(change({ header })))[0]!.header).toBe(header)
  })

  it('has a spoken sentence per row, with the routes', () => {
    expect(rows(join(change()))[0]!.spoken).toBe('1: skips this station, downtown only, until 8:22 PM.')
    expect(rows(join(change({ routes: ['A', 'C', 'E'], kind: 'other', direction: null, until: null })))[0]!.spoken).toBe('A, C and E: service change.')
  })
})

describe('serviceChangeView body and skipSpoken', () => {
  it('none and unknown bodies', () => {
    const none = serviceChangeView({ panel: { kind: 'none' }, known: true }, group('M'), routeById, NOW)
    expect(none).toEqual({ known: true, body: { kind: 'none' }, skipSpoken: '' })
    const unknown = serviceChangeView({ panel: { kind: 'unknown' }, known: false }, group('M'), routeById, NOW)
    expect(unknown).toEqual({ known: false, body: { kind: 'unknown', text: UNKNOWN_TEXT }, skipSpoken: '' })
  })

  it('says a skip that is in effect, by direction, in Manhattan words', () => {
    const j = join(change(), change({ alertId: 'b', routes: ['2'], direction: 'N' }))
    expect(serviceChangeView(j, group('M'), routeById, NOW).skipSpoken).toBe('Uptown 2 trains skip this station now. Downtown 1 trains skip this station now.')
  })

  it('never says a guess, a skip not yet in effect, or another kind; says both directions with no direction word', () => {
    const quiet = join(change({ probable: true }), change({ now: false, from: NOW + 100 }), change({ kind: 'suspended' }), change({ kind: 'other' }))
    expect(serviceChangeView(quiet, group('M'), routeById, NOW).skipSpoken).toBe('')
    expect(serviceChangeView(join(change({ direction: null, routes: ['A', 'C'] })), group('M'), routeById, NOW).skipSpoken).toBe('A and C trains skip this station now.')
    expect(serviceChangeView(join(change({ direction: 'S' })), group('Bk'), routeById, NOW).skipSpoken).toBe('Southbound 1 trains skip this station now.')
  })

  it('says an express by its name', () => {
    expect(serviceChangeView(join(change({ direction: null, routes: ['7X'] })), group('M'), routeById, NOW).skipSpoken).toBe('7 express trains skip this station now.')
  })
})
