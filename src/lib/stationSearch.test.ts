import { describe, expect, it } from 'vitest'
import stationsRaw from '../../public/data/stations.json?raw'
import type { StationsFile } from '../data/schema'
import { buildSearchIndex, searchStations, type SearchableStation } from './stationSearch'

function station(id: string, name: string, routeIds: string[]): SearchableStation {
  return { id, name, routeIds }
}

const FIXTURE = [
  station('145', '145 St', ['1']),
  station('132', '14 St', ['1', '2', '3']),
  station('635', '14 St-Union Sq', ['4', '5', '6']),
  station('405', 'Bedford Park Blvd-Lehman College', ['4']),
  station('L08', 'Bedford Av', ['L']),
  station('235', 'Atlantic Av-Barclays Ctr', ['2', '3', '4', '5']),
  station('L24', 'Atlantic Av', ['L']),
  station('127', 'Times Sq-42 St', ['1', '2', '3']),
  station('R16', 'Times Sq-42 St', ['N', 'Q', 'R', 'W']),
  station('121', '86 St', ['1', '2']),
  station('N10', '86 St', ['N', 'W']),
  station('F05', 'Jamaica-179 St', ['F']),
  station('L03', '14 St-Union Sq', ['L']),
  station('A32', 'W 4 St-Wash Sq', ['A', 'C', 'E']),
  station('234', 'Nevins St', ['2', '3', '4', '5']),
  station('L10', 'Woodlawn', ['4']),
  station('R05', 'Broadway', ['N', 'W']),
  station('G21', 'Queens Plaza', ['E', 'F', 'R']),
]

const ids = (stations: SearchableStation[]) => stations.map((s) => s.id)
const index = buildSearchIndex(FIXTURE)
const find = (q: string) => ids(searchStations(index, q))

describe('searchStations', () => {
  it('is empty for a blank query', () => {
    expect(find('')).toEqual([])
    expect(find('  ')).toEqual([])
    expect(find('the')).toEqual([])
  })
  it('puts exact starts first', () => {
    expect(find('bedford')).toEqual(['L08', '405'])
  })
  it('reads abbreviations', () => {
    expect(find('atl av')).toEqual(['L24', '235'])
    expect(find('atlantic avenue')).toEqual(['L24', '235'])
  })
  it('breaks name ties by route count, then id', () => {
    expect(find('times sq')).toEqual(['R16', '127'])
    expect(find('86 st')).toEqual(['121', 'N10'])
  })
  it('does not let a number prefix a longer number unless it is last', () => {
    expect(find('14 st')).toEqual(['132', '635', 'L03'])
    expect(find('14th street')).toEqual(['132', '635', 'L03'])
    expect(find('14')).toEqual(['132', '635', 'L03', '145'])
  })
  it('ranks an exact number above a longer one even for a one-route, long-named station', () => {
    for (const q of ['14', '14t']) {
      const r = find(q)
      expect(r.indexOf('L03'), q).toBeLessThan(r.indexOf('145'))
    }
  })
  it('does not let an ordinal ("14th") start a longer number', () => {
    expect(find('14th')).not.toContain('145')
    expect(find('14th')).toContain('L03')
  })
  it('keeps matching while a long form or ordinal is half typed', () => {
    expect(find('14 stre')).toContain('132')
    expect(find('times squa')[0]).toBe('R16')
    expect(find('atlantic aven')[0]).toBe('L24')
    expect(find('14t')).toContain('132')
    expect(find('2n')).toEqual([])
    expect(find('14th str')).toContain('635')
  })
  it('reads a direction word as its letter, not as every word starting with it', () => {
    expect(find('west')[0]).toBe('A32')
    expect(find('west')).not.toContain('L10')
    expect(find('north')).not.toContain('234')
  })
  it('knows shorthands', () => {
    expect(find('bway')[0]).toBe('R05')
    expect(find('b way')[0]).toBe('R05')
    expect(find('qns')[0]).toBe('G21')
  })
  it('finds words in the middle of a name, less eagerly', () => {
    expect(find('union')).toEqual(['635', 'L03'])
    expect(find('179')).toEqual(['F05'])
  })
  it('forgives a swapped or missing letter in longer words', () => {
    expect(find('bedfrod')[0]).toBe('L08')
    expect(find('atlantc')[0]).toBe('L24')
    expect(find('bedfrod')).toContain('405')
  })
  it('does not fuzzy-match words under four letters', () => {
    expect(find('bdf')).toEqual([])
    expect(find('zzz')).toEqual([])
  })
  it('excludes a station when any query word misses', () => {
    expect(find('bedford 86')).toEqual([])
  })
  it('honours the limit', () => {
    expect(searchStations(index, '1', 2)).toHaveLength(2)
  })
})

/** Every keystroke prefix of `typed` from `from` characters on must keep a station named one of `names` in the top 5. */
function keepsInTop5(index: ReturnType<typeof buildSearchIndex<SearchableStation>>, typed: string, from: number, names: string[]) {
  for (let len = from; len <= typed.length; len++) {
    const prefix = typed.slice(0, len)
    const top = searchStations(index, prefix, 5).map((s) => s.name)
    expect(top.some((n) => names.includes(n)), `"${prefix}" -> ${top.join(' | ')}`).toBe(true)
  }
}

describe('real public/data/stations.json', () => {
  const file = JSON.parse(stationsRaw) as StationsFile
  const real = file.stations.map((s) => ({ id: s.id, name: s.name, routeIds: s.routes }))
  const realIndex = buildSearchIndex(real)
  const top = (q: string, n: number) => ids(searchStations(realIndex, q, n))

  it('finds the expected stations first', () => {
    expect(top('bedford', 1)).toEqual(['L08'])
    expect(top('atl av', 1)).toEqual(['L24'])
    expect(top('times sq', 1)).toEqual(['R16'])
    expect(top('bedfrod', 1)).toEqual(['L08'])
  })
  it('lists the 14 St stations before 14 St-Union Sq, and never 145 St', () => {
    const names = ids(searchStations(realIndex, '14 st')).map((id) => real.find((s) => s.id === id)!.name)
    expect(names.length).toBeGreaterThan(2)
    expect(names).not.toContain('145 St')
    const firstUnion = names.indexOf('14 St-Union Sq')
    expect(names.slice(0, firstUnion).every((n) => n === '14 St')).toBe(true)
    expect(names.slice(firstUnion).every((n) => n === '14 St-Union Sq')).toBe(true)
    expect(ids(searchStations(realIndex, '14th street'))).toEqual(ids(searchStations(realIndex, '14 st')))
  })
  it('keeps the target in the top 5 at every keystroke', () => {
    keepsInTop5(realIndex, 'times square', 3, ['Times Sq-42 St'])
    keepsInTop5(realIndex, '14th street', 3, ['14 St', '14 St-Union Sq'])
    keepsInTop5(realIndex, 'atlantic avenue', 3, ['Atlantic Av', 'Atlantic Av-Barclays Ctr'])
  })
  it('puts W 4 St first for "west 4" and keeps single letters out of fuzzy matches', () => {
    expect(real.find((s) => s.id === top('west 4', 1)[0])!.name).toMatch(/^W 4 St/)
    expect(searchStations(realIndex, 'east').every((s) => /(^|[^a-z])e([^a-z]|$)|east/i.test(s.name))).toBe(true)
  })
  it('keeps (name, routes) unique, so route chips tell duplicate names apart', () => {
    const seen = new Map<string, string>()
    for (const s of real) {
      const key = `${s.name}|${[...s.routeIds].sort().join(',')}`
      expect(seen.get(key), `${s.id} and ${seen.get(key)} look identical in the results`).toBeUndefined()
      seen.set(key, s.id)
    }
  })
})
