import { describe, expect, it } from 'vitest'
import { realGroups } from './realGroups.testdata'
import { ALIAS_PENALTY, buildSearchIndex, searchStations, type SearchableStation } from './stationSearch'

const station = (id: string, name: string, routeIds: string[], otherNames: string[] = []): SearchableStation => ({ id, name, routeIds, otherNames })

describe('searchStations over other member names', () => {
  const index = buildSearchIndex([
    station('T', 'Times Sq-42 St', ['1', '2', '3'], ['42 St-Port Authority Bus Terminal']),
    station('P', 'Port Richmond', ['SI']),
  ])
  const find = (q: string) => searchStations(index, q).map((s) => s.id)

  it('finds a group by another member name', () => {
    expect(find('port authority')).toEqual(['T'])
  })
  it("ranks a station's own name above an equal alias match", () => {
    const own = buildSearchIndex([station('A', 'Zeta Av', ['A'], ['Lorimer St']), station('B', 'Lorimer St', ['A'])])
    expect(searchStations(own, 'lorimer').map((s) => s.id)).toEqual(['B', 'A'])
    expect(ALIAS_PENALTY).toBeGreaterThan(0)
  })
})

describe('searchStations over the committed station groups', () => {
  const index = buildSearchIndex(realGroups)
  const find = (q: string, limit?: number) => searchStations(index, q, limit)

  it('lists a complex once: "times sq" gives one result, "86 st" gives the six stations', () => {
    const times = find('times sq').filter((s) => s.name === 'Times Sq-42 St')
    expect(times).toHaveLength(1)
    expect(find('86 st').filter((s) => s.name === '86 St')).toHaveLength(6)
  })

  it('finds Times Sq by its Port Authority member name', () => {
    expect(find('port authority', 3).map((s) => s.name)).toContain('Times Sq-42 St')
  })

  it('ranks the J/M Lorimer St above the Metropolitan Av group that lists a Lorimer St member', () => {
    const results = find('lorimer')
    expect(results[0]!.name).toBe('Lorimer St')
    expect(results[0]!.routeIds).toContain('M')
    const metropolitan = results.findIndex((s) => s.name === 'Metropolitan Av')
    expect(metropolitan).toBeGreaterThan(0)
  })
})
