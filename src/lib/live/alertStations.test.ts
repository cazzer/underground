import { describe, expect, it } from 'vitest'
import type { ServiceAlert } from '../../data/realtime'
import type { Station } from '../network'
import { alertKindOf, headerNamedStations, skipClause, skipSetsOf, stretchEnds } from './alertStations'

const named = (header: string, names: string[]) => [...headerNamedStations(header, names.map((name, i) => ({ id: `s${i}`, name })))].map((id) => names[Number(id.slice(1))])

describe('alertKindOf', () => {
  it('reads the MTA type words, part suspended before suspended', () => {
    expect(alertKindOf('Planned - Stops Skipped')).toBe('skip')
    expect(alertKindOf('Stop Skipped')).toBe('skip')
    expect(alertKindOf('Planned - Part Suspended')).toBe('part')
    expect(alertKindOf('Planned - Suspended')).toBe('suspended')
    for (const other of ['Delays', 'Station Notice', 'Planned - Express to Local', 'Boarding Change', null]) expect(alertKindOf(other)).toBe('other')
  })
})

describe('skipClause', () => {
  it('runs from the skip to the first line break, ";", ". " or a due to / for / while', () => {
    expect(skipClause('Downtown [1] skips 125 St')).toBe(' 125 St')
    expect(skipClause('In Queens, Flushing-bound [7] skips 52 St and 69 St\nAll trains at Woodside-61 St board')).toBe(' 52 St and 69 St')
    expect(skipClause('[A] skips 81 St in both directions due to the Parade')).toBe(' 81 St in both directions')
    expect(skipClause('[R] skip Union St; no service at 36 St')).toBe(' Union St')
    expect(skipClause('[R] skip Union St while work is done')).toBe(' Union St')
  })

  it('gives the first line when there is no skip', () => {
    expect(skipClause('Enter at 5 Av only\nMadison Av is exit only')).toBe('Enter at 5 Av only')
  })
})

describe('headerNamedStations', () => {
  it('matches whole words: 25 St is not in 125 St', () => {
    expect(named('Downtown [1] skips 125 St', ['125 St', '25 St', '5 St'])).toEqual(['125 St'])
  })

  it('matches a part of a hyphen, slash or parenthesis name', () => {
    expect(named('[6] skips 68 St and 51 St', ['68 St-Hunter College', '51 St', '59 St'])).toEqual(['68 St-Hunter College', '51 St'])
    expect(named('[F] skips Jay St', ['Jay St-MetroTech', 'Borough Hall'])).toEqual(['Jay St-MetroTech'])
    expect(named('[A] skips 110 St', ['Cathedral Pkwy (110 St)', '116 St'])).toEqual(['Cathedral Pkwy (110 St)'])
    expect(named('[R] skips 4 Av-9 St', ['4 Av-9 St', '9 St'])).toEqual(['4 Av-9 St', '9 St'])
  })

  it('matches the whole name, and the long and short spellings alike (Avenue and Av, Fort and Ft)', () => {
    expect(named('[7] skips 81 St-Museum of Natural History', ['81 St-Museum of Natural History'])).toEqual(['81 St-Museum of Natural History'])
    expect(named('[R] skips Prospect Avenue and Fort Hamilton Pkwy', ['Prospect Av', 'Ft Hamilton Pkwy'])).toEqual(['Prospect Av', 'Ft Hamilton Pkwy'])
  })

  it('does not read what is past the clause: a second line, a "due to" cause', () => {
    expect(named('[7] skips 52 St\nAll trains at Woodside-61 St board', ['52 St', '61 St-Woodside'])).toEqual(['52 St'])
    expect(named('[7] skips 52 St due to work at 69 St', ['52 St', '69 St'])).toEqual(['52 St'])
  })

  it('names nothing from words before the skip (the direction, the line)', () => {
    expect(named('Flushing-bound [7] skips 52 St', ['Flushing-Main St', '52 St'])).toEqual(['52 St'])
  })
})

describe('stretchEnds', () => {
  const pos = new Map([['a', { x: 0, z: 0 }], ['b', { x: 10, z: 0 }], ['c', { x: 4, z: 1 }], ['d', { x: -3, z: 0 }]])
  const at = (id: string) => pos.get(id)!

  it('is the farthest pair', () => {
    expect(new Set(stretchEnds(['a', 'c', 'b', 'd'], at))).toEqual(new Set(['b', 'd']))
  })

  it('gives one station twice', () => {
    expect(stretchEnds(['c'], at)).toEqual(['c', 'c'])
  })
})

const station = (id: string, name: string, x: number): Station => ({
  id,
  name,
  pos: { x, z: 0 },
  routeIds: ['1'],
  stops: [`${id}N`, `${id}S`],
  access: { status: 'none' },
  leadId: id,
})
const stations = new Map([
  station('a', 'Alpha St', 0),
  station('b', 'Beta St', 100),
  station('c', 'Gamma St', 200),
  station('d', 'Delta St', 300),
  station('e', 'Epsilon St', 400),
].map((s) => [s.id, s]))

const alert = (over: Partial<ServiceAlert>): ServiceAlert => ({
  id: 'x',
  type: 'Planned - Stops Skipped',
  header: 'Downtown [1] skips Beta St',
  period: null,
  periods: [[0, null]],
  entities: ['a', 'b', 'c'].map((stop) => ({ route: '1', stop, direction: 'S' as const })),
  ...over,
})

describe('skipSetsOf', () => {
  it('is the header-named stations out of the informed ones, with the shared direction', () => {
    const [set, ...rest] = skipSetsOf(alert({}), stations)
    expect(rest).toEqual([])
    expect(set).toMatchObject({ alertId: 'x', route: '1', direction: 'S', probable: false, periods: [[0, null]] })
    expect([...set!.stations]).toEqual(['b'])
  })

  it('names nothing outside the informed stops', () => {
    expect(skipSetsOf(alert({ header: 'Downtown [1] skips Epsilon St' }), stations)[0]).toMatchObject({ probable: true })
  })

  it('falls back to the informed stops without the stretch ends, marked probable, when the header names none', () => {
    const [set] = skipSetsOf(alert({ header: 'Downtown [1] trains run express' }), stations)
    expect([...set!.stations]).toEqual(['b'])
    expect(set!.probable).toBe(true)
  })

  it('falls back to every informed stop when there are two or fewer, still probable', () => {
    const two = alert({ header: 'Express', entities: ['a', 'b'].map((stop) => ({ route: '1', stop, direction: 'S' as const })) })
    const [set] = skipSetsOf(two, stations)
    expect([...set!.stations].sort()).toEqual(['a', 'b'])
    expect(set!.probable).toBe(true)
  })

  it('has one set per route with stops; the direction is shared or null', () => {
    const entities = [
      { route: '1', stop: 'b', direction: 'S' as const },
      { route: '1', stop: 'c', direction: 'N' as const },
      { route: '2', stop: 'b', direction: null },
      { route: '3', stop: null, direction: null },
    ]
    const sets = skipSetsOf(alert({ entities }), stations)
    expect(sets.map((s) => [s.route, s.direction])).toEqual([['1', null], ['2', null]])
  })

  it('has none for another kind of alert, and omits a route whose informed stops the map lacks', () => {
    expect(skipSetsOf(alert({ type: 'Delays' }), stations)).toEqual([])
    expect(skipSetsOf(alert({ entities: [{ route: '1', stop: 'zz', direction: null }] }), stations)).toEqual([])
  })
})
