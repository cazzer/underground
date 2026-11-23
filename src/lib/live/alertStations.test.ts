import { describe, expect, it } from 'vitest'
import type { ServiceAlert } from '../../data/realtime'
import type { Station } from '../network'
import { alertKindOf, headerNamedStations, headerStretchEnds, skipClause, skipSetsOf, stretchEnds } from './alertStations'

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

  it('is empty when there is no skip: "runs express from A to B" names the ends of the stretch, not skipped stations', () => {
    expect(skipClause('Enter at 5 Av only\nMadison Av is exit only')).toBe('')
    expect(skipClause('In the Bronx, Manhattan-bound [6] runs express from Parkchester to 3 Av-138 St')).toBe('')
    expect(named('In the Bronx, Manhattan-bound [6] runs express from Parkchester to 3 Av-138 St', ['Parkchester', '3 Av-138 St'])).toEqual([])
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
    expect(named('[R] skips 4 Av-9 St', ['4 Av-9 St', '9 St'])).toEqual(['4 Av-9 St'])
  })

  it('matches the whole name, and the long and short spellings alike (Avenue and Av, Fort and Ft)', () => {
    expect(named('[7] skips 81 St-Museum of Natural History', ['81 St-Museum of Natural History'])).toEqual(['81 St-Museum of Natural History'])
    expect(named('[R] skips Prospect Avenue and Fort Hamilton Pkwy', ['Prospect Av', 'Ft Hamilton Pkwy'])).toEqual(['Prospect Av', 'Ft Hamilton Pkwy'])
  })

  it('does not read what is past the clause: a second line, a "due to" cause', () => {
    expect(named('[7] skips 52 St\nAll trains at Woodside-61 St board', ['52 St', '61 St-Woodside'])).toEqual(['52 St'])
    expect(named('[7] skips 52 St due to work at 69 St', ['52 St', '69 St'])).toEqual(['52 St'])
  })

  it('reads each item of the clause: a trailing remark still matches, a longer name does not', () => {
    expect(named('[A] skips 81 St in both directions - Take the [C] instead', ['81 St'])).toEqual(['81 St'])
    expect(named('[A] skips 4 Av-9 St', ['Smith-9 Sts', '4 Av-9 St'])).toEqual(['4 Av-9 St'])
    expect(named('[A] skips 3 Av-149 St', ['149 St-Hostos', '3 Av-149 St'])).toEqual(['3 Av-149 St'])
    expect(named('[F] skips 4 Av/9 St', ['4 Av-9 St'])).toEqual(['4 Av-9 St'])
  })

  it('does not let a neighbour sharing words take the item: the longest matching form wins, a whole name winning a tie', () => {
    expect(named('[2] skips 149 St-Hostos', ['3 Av-149 St', '149 St-Hostos'])).toEqual(['149 St-Hostos'])
    expect(named('[2] skips 3 Av-149 St', ['3 Av-149 St', '149 St-Hostos'])).toEqual(['3 Av-149 St'])
    expect(named('[E] skips Sutphin Blvd', ['Sutphin Blvd', 'Sutphin Blvd-Archer Av-JFK Airport'])).toEqual(['Sutphin Blvd'])
    expect(named('[E] skips Sutphin Blvd-Archer Av-JFK Airport', ['Sutphin Blvd', 'Sutphin Blvd-Archer Av-JFK Airport'])).toEqual(['Sutphin Blvd-Archer Av-JFK Airport'])
    expect(named('[N] skips 59 St', ['59 St', 'Lexington Av/59 St', '5 Av/59 St'])).toEqual(['59 St'])
    expect(named('[F] skips Lexington Av/63 St', ['Lexington Av/53 St', 'Lexington Av/63 St'])).toEqual(['Lexington Av/63 St'])
  })

  it('names every station of one name', () => {
    expect(named('[N] skips Canal St', ['Canal St', 'Canal St', 'Spring St'])).toEqual(['Canal St', 'Canal St'])
  })

  it('reads the whole 35969 header: three names, with Smith-9 Sts among the informed stops', () => {
    const header = 'In Brooklyn, Coney Island-bound [F] and Church Av-bound [G] skip 4 Av-9 St, 15 St-Prospect Park and Fort Hamilton Pkwy'
    const names = ['Smith-9 Sts', '4 Av-9 St', '15 St-Prospect Park', 'Fort Hamilton Pkwy', 'Bergen St', 'Church Av', 'Coney Island-Stillwell Av']
    expect(named(header, names)).toEqual(['4 Av-9 St', '15 St-Prospect Park', 'Fort Hamilton Pkwy'])
  })

  it('names nothing from words before the skip (the direction, the line)', () => {
    expect(named('Flushing-bound [7] skips 52 St', ['Flushing-Main St', '52 St'])).toEqual(['52 St'])
  })
})

describe('headerStretchEnds', () => {
  const cands = ['E 180 St', '3 Av-149 St', '149 St-Hostos', 'Grand Central-42 St'].map((name, i) => ({ id: `s${i}`, name }))

  it('is the stations a "from X to Y" or "express X to Y" first line names', () => {
    expect(headerStretchEnds('In the Bronx, [2][5] runs express from E 180 St to 3 Av-149 St\nAll trains at E 180 St board', cands)).toEqual(['s0', 's1'])
    expect(headerStretchEnds('[6] runs express 3 Av-149 St to Grand Central-42 St', cands)).toEqual(['s1', 's3'])
  })

  it('is null with no such stretch, or when an end names no candidate', () => {
    expect(headerStretchEnds('Downtown [1] trains run express', cands)).toBeNull()
    expect(headerStretchEnds('[6] runs express from E 180 St to Nowhere', cands)).toBeNull()
    expect(headerStretchEnds('Trains board from the platform\nruns express from E 180 St to 3 Av-149 St', cands)).toBeNull()
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
  periods: [[0, null]],
  entities: ['a', 'b', 'c'].map((stop) => ({ route: '1', stop, direction: 'S' as const })),
  ...over,
})

describe('skipSetsOf with a "from X to Y" header', () => {
  it('takes X and Y as the ends of the stretch, even when X is not informed', () => {
    const a = alert({ header: 'Downtown [1] runs express from Alpha St to Delta St', entities: ['b', 'c', 'd'].map((stop) => ({ route: '1', stop, direction: 'S' as const })) })
    const [set] = skipSetsOf(a, stations)
    expect([...set!.stations].sort()).toEqual(['b', 'c'])
    expect(set!.probable).toBe(true)
  })

  it('without it takes the farthest pair, as before', () => {
    const a = alert({ header: 'Downtown [1] runs express', entities: ['b', 'c', 'd'].map((stop) => ({ route: '1', stop, direction: 'S' as const })) })
    expect([...skipSetsOf(a, stations)[0]!.stations]).toEqual(['c'])
  })
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
