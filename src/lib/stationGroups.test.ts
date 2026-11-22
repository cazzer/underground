import { describe, expect, it } from 'vitest'
import type { Station } from './network'
import { buildStationGroups, groupAccess, groupName, stationLeads } from './stationGroups'

const station = (id: string, name: string, routeIds: string[], access: Station['access'] = { status: 'none' }, stops = [`${id}N`, `${id}S`]): Station => ({
  id,
  name,
  pos: { x: Number.parseInt(id.replace(/\D/g, '') || '0', 10), z: 0 },
  routeIds,
  stops,
  access,
  leadId: id,
})

const order = new Map(['1', '2', 'A', 'C', 'E', 'L', 'N', 'Q', 'R', '6', '6X', 'FX'].map((id, i) => [id, i]))
const routeName = (id: string): string => id

describe('stationLeads', () => {
  const known = new Set(['A', 'B', 'C'])
  it('maps every member to its lead', () => {
    expect(stationLeads([['B', 'A', 'C']], known)).toEqual(new Map([['B', 'B'], ['A', 'B'], ['C', 'B']]))
  })
  it('throws on an unknown id, a lone member and an id in two complexes', () => {
    expect(() => stationLeads([['A', 'X']], known)).toThrow(/X is not a station/)
    expect(() => stationLeads([['A']], known)).toThrow(/fewer than 2/)
    expect(() => stationLeads([['A', 'B'], ['C', 'B']], known)).toThrow(/B is in two complexes/)
  })
})

describe('groupName', () => {
  it('is the most common name, the others in member order', () => {
    expect(groupName([{ name: 'X' }, { name: 'Y' }, { name: 'Y' }, { name: 'Z' }])).toEqual({ name: 'Y', otherNames: ['X', 'Z'] })
  })
  it('gives a tie to the first member, the lead', () => {
    expect(groupName([{ name: 'Times Sq-42 St' }, { name: '42 St-Port Authority' }])).toEqual({ name: 'Times Sq-42 St', otherNames: ['42 St-Port Authority'] })
  })
  it('has no other names when all agree', () => {
    expect(groupName([{ name: 'A' }, { name: 'A' }])).toEqual({ name: 'A', otherNames: [] })
  })
})

describe('groupAccess', () => {
  const full = { status: 'full' } as const
  const none = { status: 'none' } as const
  const partial = (note: string) => ({ status: 'partial', note }) as const
  it('is full only when every member is, and none only when none is', () => {
    expect(groupAccess([{ routeIds: ['1'], access: full }, { routeIds: ['2'], access: full }], routeName)).toEqual({ status: 'full' })
    expect(groupAccess([{ routeIds: ['1'], access: none }, { routeIds: ['2'], access: none }], routeName)).toEqual({ status: 'none' })
  })
  it('lists the fully accessible routes with " only" when mixed with an inaccessible member', () => {
    const members = [
      { routeIds: ['L'], access: full },
      { routeIds: ['N', 'Q', 'R'], access: full },
      { routeIds: ['6'], access: none },
    ]
    expect(groupAccess(members, routeName)).toEqual({ status: 'partial', note: 'L, N, Q, R only' })
  })
  it('adds each partly accessible member with its own note', () => {
    const members = [
      { routeIds: ['7', 'G'], access: full },
      { routeIds: ['E', 'FX'], access: partial('Manhattan-bound only') },
    ]
    expect(groupAccess(members, routeName)).toEqual({ status: 'partial', note: '7, G; E, FX Manhattan-bound only' })
  })
  it('lists routes in route order, whatever the member order, unknown routes last by id', () => {
    const members = [
      { routeIds: ['Q', 'N'], access: full },
      { routeIds: ['L', 'ZZ', 'YY'], access: full },
      { routeIds: ['6'], access: none },
    ]
    expect(groupAccess(members, routeName, order).note).toBe('L, N, Q, YY, ZZ only')
  })
  it('drops an express variant whose base is listed, and keeps one alone', () => {
    expect(groupAccess([{ routeIds: ['6', '6X'], access: full }, { routeIds: ['A'], access: none }], routeName).note).toBe('6 only')
    expect(groupAccess([{ routeIds: ['6X'], access: full }, { routeIds: ['A'], access: none }], routeName).note).toBe('6X only')
  })
})

describe('buildStationGroups', () => {
  const stations = [
    station('127', 'Times Sq-42 St', ['1', '2'], { status: 'full' }, ['127N', '127S']),
    station('725', 'Times Sq-42 St', ['A', 'C'], { status: 'none' }, ['725N', '725S']),
    station('A27', '42 St-Port Authority Bus Terminal', ['E', 'A'], { status: 'full' }, ['A27N', 'A27S']),
    station('B01', 'Alone', ['L']),
  ]
  const { groups, groupById } = buildStationGroups(stations, [['725', '127', 'A27']], order, routeName)

  it('makes one group per lone station and per complex, at the lead, in stations order', () => {
    expect(groups.map((g) => g.id)).toEqual(['725', 'B01'])
    expect(groups.map((g) => g.memberIds)).toEqual([['725', '127', 'A27'], ['B01']])
  })
  it('takes the lead as the group, names it and keeps the other names', () => {
    expect(groups[0]).toMatchObject({ id: '725', leadId: '725', pos: stations[1]!.pos, name: 'Times Sq-42 St', otherNames: ['42 St-Port Authority Bus Terminal'] })
  })
  it('unions routes in route order and stops sorted', () => {
    expect(groups[0]!.routeIds).toEqual(['1', '2', 'A', 'C', 'E'])
    expect(groups[0]!.stops).toEqual(['127N', '127S', '725N', '725S', 'A27N', 'A27S'])
  })
  it('merges access', () => {
    expect(groups[0]!.access).toEqual({ status: 'partial', note: '1, 2, A, E only' })
    expect(groups[1]!.access).toEqual({ status: 'none' })
  })
  it('sorts routes with none in the order by id instead of NaN', () => {
    const odd = buildStationGroups([station('X1', 'X', ['B', 'L']), station('X2', 'X', ['C', 'A'])], [['X1', 'X2']], new Map(), routeName)
    expect(odd.groups[0]!.routeIds).toEqual(['A', 'B', 'C', 'L'])
  })
  it('maps every station id, a member too, to its group', () => {
    expect([...groupById.keys()].sort()).toEqual(['127', '725', 'A27', 'B01'])
    expect(groupById.get('A27')).toBe(groups[0])
  })
})
