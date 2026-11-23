import { describe, expect, it } from 'vitest'
import { toGround } from './projection'
import { realGroups, realStations } from './realGroups.testdata'
import { fixDistanceOf } from './searchHere'
import { buildSearchIndex, searchStations, type SearchableStation } from './stationSearch'

const station = (id: string, name: string, routeIds: string[]): SearchableStation => ({ id, name, routeIds })

describe('searchStations with a distance to a fix', () => {
  const index = buildSearchIndex([station('A', '86 St', ['1', '2']), station('B', '86 St', ['N']), station('C', '86 St', ['4', '5', '6'])])
  const dist: Record<string, number> = { A: 900, B: 120, C: 5000 }
  const ids = (q: string, distanceOf?: (s: SearchableStation) => number) => searchStations(index, q, undefined, distanceOf).map((s) => s.id)

  it('puts the nearest first among equal scores, ahead of the route count', () => {
    expect(ids('86 st')).toEqual(['C', 'A', 'B'])
    expect(ids('86 st', (s) => dist[s.id]!)).toEqual(['B', 'A', 'C'])
  })

  it('lets a better match beat a nearer one', () => {
    const mixed = buildSearchIndex([station('far', 'Bedford Av', ['L']), station('near', 'Bedford Park Blvd', ['4'])])
    const d: Record<string, number> = { far: 9000, near: 10 }
    expect(searchStations(mixed, 'bedford av', undefined, (s) => d[s.id]!)[0]!.id).toBe('far')
  })

  it('computes each match once', () => {
    let calls = 0
    searchStations(index, '86 st', undefined, () => ++calls)
    expect(calls).toBe(3)
  })
})

describe('searchStations without a distance', () => {
  const index = buildSearchIndex(realGroups)
  const queries = ['14 st', 'times sq', '86 st', 'atlantic', 'lorimer', 'bedford', 'broadway', 'jay', 'w 4']
  it('orders exactly as with no distance function', () => {
    for (const q of queries) {
      expect(searchStations(index, q, 20, undefined).map((s) => s.id), q).toEqual(searchStations(index, q).map((s) => s.id))
    }
  })
})

describe('a complex ranks by its nearest member', () => {
  const stationById = new Map(realStations.map((s) => [s.id, s]))
  const times = realGroups.find((g) => g.name === 'Times Sq-42 St')

  it('is 0 m away from any member, not only the lead', () => {
    if (!times) throw new Error('Times Sq group missing from the committed data')
    expect(times.memberIds.length).toBeGreaterThan(1)
    for (const id of times.memberIds) expect(fixDistanceOf(stationById.get(id)!.pos, stationById)(times)).toBe(0)
  })

  it('never exceeds the distance to the lead', () => {
    const elsewhere = toGround({ lat: 40.7, lon: -74.0 })
    const lead = Math.hypot(times!.pos.x - elsewhere.x, times!.pos.z - elsewhere.z)
    expect(fixDistanceOf(elsewhere, stationById)(times!)).toBeLessThanOrEqual(lead)
  })
})
