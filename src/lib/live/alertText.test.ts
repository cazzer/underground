import { describe, expect, it } from 'vitest'
import type { Route } from '../network'
import type { StationGroup } from '../stationGroups'
import type { ChangesJoin, StationChange } from './alertJoin'
import { serviceChangeView, typeWord, UNKNOWN_TEXT } from './alertText'
import type { TerminalOf } from './routeTerminals'

// 2026-11-23 15:22 New York (Monday).
const NOW = 1795465325
const route = (id: string, shortName = id): [string, Route] => [id, { id, shortName, longName: id, color: '#000000' }]
const routeById = new Map([route('1'), route('2'), route('A'), route('C'), route('E'), route('F'), route('G'), route('L'), route('7'), route('GS', 'S'), route('7X', '7X')])
const TERMINALS: Record<string, string> = {
  'L|N': '8 Av',
  'L|S': 'Canarsie',
  '7|N': 'Flushing',
  '7|S': 'Hudson Yards',
  '7X|N': 'Flushing',
  'GS|N': 'Grand Central',
  'F|S': 'Coney Island',
  'G|S': 'Church Av',
}
const terminalOf: TerminalOf = (r, d) => TERMINALS[`${r}|${d}`] ?? null
const group = (borough: 'M' | 'Bk' | 'Q'): StationGroup => ({
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
  type: 'Planned - Stops Skipped',
  routeWide: false,
  ...over,
})
const join = (...changes: StationChange[]): ChangesJoin => ({ panel: { kind: 'changes', changes }, known: true })
const view = (j: ChangesJoin, borough: 'M' | 'Bk' | 'Q' = 'M') => serviceChangeView(j, group(borough), routeById, NOW, terminalOf)
const rows = (j: ChangesJoin, borough: 'M' | 'Bk' | 'Q' = 'M') => {
  const v = view(j, borough)
  return v.body.kind === 'changes' ? v.body.rows : []
}

describe('serviceChangeView rows', () => {
  it('skips: our line (kept whole) with uptown and downtown for a north-south line in Manhattan, over the verbatim header', () => {
    expect(rows(join(change()))[0]).toMatchObject({ parts: ['skips this station', 'downtown only', 'until 8:22 PM'], header: 'Downtown [1] skips G St' })
    expect(rows(join(change({ direction: 'N' })))[0]!.parts[1]).toBe('uptown only')
  })

  it('words the direction by where the train goes everywhere else: the L, the 7 and the S shuttle even in Manhattan', () => {
    expect(rows(join(change({ routes: ['L'], direction: 'S' })))[0]!.parts[1]).toBe('Canarsie-bound only')
    expect(rows(join(change({ routes: ['L'], direction: 'N' })))[0]!.parts[1]).toBe('8 Av-bound only')
    expect(rows(join(change({ routes: ['7'], direction: 'N' })))[0]!.parts[1]).toBe('Flushing-bound only')
    expect(rows(join(change({ routes: ['GS'], direction: 'N' })))[0]!.parts[1]).toBe('Grand Central-bound only')
    expect(rows(join(change({ routes: ['1'], direction: 'S' })), 'Bk')[0]!.parts[1]).toBe('one direction only')
    expect(rows(join(change({ routes: ['F'], direction: 'S' })), 'Bk')[0]!.parts[1]).toBe('Coney Island-bound only')
  })

  it('says "one direction only" when the terminal is unknown, and keeps both terminals for routes that differ', () => {
    expect(rows(join(change({ routes: ['2'], direction: 'N' })), 'Bk')[0]!.parts[1]).toBe('one direction only')
    expect(rows(join(change({ routes: ['F', 'G'], direction: 'S' })), 'Bk')[0]!.parts[1]).toBe('Coney Island-bound and Church Av-bound only')
  })

  it('two or more routes take "skip", one takes "skips"; a guess says probably', () => {
    expect(rows(join(change({ routes: ['F', 'G'], direction: null })))[0]!.parts[0]).toBe('skip this station')
    expect(rows(join(change({ probable: true, direction: null })))[0]!.parts[0]).toBe('probably skips this station')
    expect(rows(join(change({ probable: true, routes: ['A', 'C'], direction: null })))[0]!.parts[0]).toBe('probably skip this station')
  })

  it('words suspensions, and other changes by their type in our words', () => {
    expect(rows(join(change({ kind: 'suspended', direction: null })))[0]!.parts[0]).toBe('no service here')
    const other = (type: string | null) => rows(join(change({ kind: 'other', direction: null, type })))[0]!.parts[0]
    expect(other('Delays')).toBe('delays')
    expect(other('Reduced Service')).toBe('reduced service')
    expect(other('Boarding Change')).toBe('boarding change')
    expect(other('Station Notice')).toBe('station notice')
    expect(other('Planned - Express to Local')).toBe('service change')
    expect(other(null)).toBe('service change')
    expect(typeWord('Planned - Delays')).toBe('delays')
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

  it('has a spoken sentence per row with no "<routes>:" form', () => {
    expect(rows(join(change()))[0]!.spoken).toBe('The 1 train skips this station, downtown only, until 8:22 PM.')
    expect(rows(join(change({ routes: ['F', 'G'], direction: 'S', now: false, from: NOW + 7200, until: null })), 'Bk')[0]!.spoken).toBe(
      'F and G trains skip this station, Coney Island-bound and Church Av-bound only, from 5:22 PM.',
    )
    expect(rows(join(change({ kind: 'suspended', routes: ['A', 'C', 'E'], direction: null, until: null })))[0]!.spoken).toBe('A, C and E trains have no service here.')
    expect(rows(join(change({ kind: 'suspended', direction: null, until: null })))[0]!.spoken).toBe('The 1 train has no service here.')
    expect(rows(join(change({ kind: 'other', type: 'Delays', routes: ['2'], direction: null, until: null })))[0]!.spoken).toBe('Delays for the 2 train.')
  })

  it('says what ended, naming the routes', () => {
    expect(rows(join(change()))[0]!.ended).toBe('The skip for the 1 train at this station has ended.')
    expect(rows(join(change({ kind: 'suspended', routes: ['A', 'C'] })))[0]!.ended).toBe('The suspension for A and C trains at this station has ended.')
    expect(rows(join(change({ kind: 'other', type: 'Delays' })))[0]!.ended).toBe('The service change for the 1 train at this station has ended.')
  })
})

describe('serviceChangeView body and skipSpoken', () => {
  it('none and unknown bodies', () => {
    const none = serviceChangeView({ panel: { kind: 'none' }, known: true }, group('M'), routeById, NOW, terminalOf)
    expect(none).toEqual({ known: true, body: { kind: 'none' }, skipSpoken: '' })
    const unknown = serviceChangeView({ panel: { kind: 'unknown' }, known: false }, group('M'), routeById, NOW, terminalOf)
    expect(unknown).toEqual({ known: false, body: { kind: 'unknown', text: UNKNOWN_TEXT }, skipSpoken: '' })
  })

  it('says a skip that is in effect with the route and its direction word', () => {
    expect(view(join(change())).skipSpoken).toBe('The downtown 1 train skips this station now.')
    expect(view(join(change({ routes: ['7'], direction: 'N' }))).skipSpoken).toBe('The Flushing-bound 7 train skips this station now.')
    expect(view(join(change({ routes: ['L'], direction: 'S' })), 'Bk').skipSpoken).toBe('The Canarsie-bound L train skips this station now.')
    expect(view(join(change({ routes: ['GS'], direction: 'N' }))).skipSpoken).toBe('The Grand Central-bound S train skips this station now.')
  })

  it('says each route with its own word, grouped', () => {
    const j = join(change({ routes: ['1', '2'], direction: 'N' }), change({ alertId: 'b', routes: ['L'], direction: 'S' }))
    expect(view(j).skipSpoken).toBe('Uptown 1 and 2 trains skip this station now. The Canarsie-bound L train skips this station now.')
  })

  it('says "in one direction" when the terminal is unknown, and nothing of direction for both', () => {
    expect(view(join(change({ routes: ['2'], direction: 'S' })), 'Bk').skipSpoken).toBe('The 2 train skips this station in one direction now.')
    expect(view(join(change({ direction: null, routes: ['A', 'C'] }))).skipSpoken).toBe('A and C trains skip this station now.')
    expect(view(join(change({ direction: null }))).skipSpoken).toBe('The 1 train skips this station now.')
  })

  it('never says a guess, a skip not yet in effect, or another kind', () => {
    const quiet = join(change({ probable: true }), change({ now: false, from: NOW + 100 }), change({ kind: 'suspended' }), change({ kind: 'other' }))
    expect(view(quiet).skipSpoken).toBe('')
  })

  it('says an express by its name', () => {
    expect(view(join(change({ direction: null, routes: ['7X'] }))).skipSpoken).toBe('The 7 express train skips this station now.')
  })
})
