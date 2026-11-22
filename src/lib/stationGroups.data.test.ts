import { describe, expect, it } from 'vitest'
import { realFile, realGroupById as groupById, realGroups as groups, realStations as stations } from './realGroups.testdata'

const membersOfGroup = (id: string) => [...groupById.get(id)!.memberIds].sort()

describe('committed station groups', () => {
  it('puts every station in exactly one group, 35 complexes making 445 groups', () => {
    expect(realFile.stations).toHaveLength(496)
    expect(groups).toHaveLength(445)
    const seen = groups.flatMap((g) => g.memberIds)
    expect(seen).toHaveLength(496)
    expect(new Set(seen).size).toBe(496)
    expect(groups.map((g) => g.id)).toEqual([...groups.map((g) => g.id)].sort())
  })

  it('makes Times Sq and Port Authority one station named for the most common name', () => {
    const times = groupById.get('A27')!
    expect(times).toBe(groupById.get('127'))
    expect(membersOfGroup('127')).toEqual(['127', '725', '902', 'A27', 'R16'])
    expect(times.name).toBe('Times Sq-42 St')
    expect(times.otherNames).toContain('42 St-Port Authority Bus Terminal')
    expect(times.id).toBe('725')
  })

  it('groups the other named complexes', () => {
    expect(membersOfGroup('L03')).toEqual(['635', 'L03', 'R20'])
    expect(membersOfGroup('235')).toEqual(['235', 'D24', 'R31'])
    expect(membersOfGroup('A38')).toEqual(['229', '418', 'A38', 'M22'])
    expect(groupById.get('635')!.id).toBe('L03')
  })

  it('leads a two-member complex with more routes (168 St is A09)', () => {
    expect(groupById.get('112')!.id).toBe('A09')
  })

  it('keeps same-named stations that are not one complex apart: six 86 Sts, and the two 14 St complexes', () => {
    const eightySix = groups.filter((g) => g.name === '86 St')
    expect(eightySix).toHaveLength(6)
    expect(eightySix.every((g) => g.memberIds.length === 1)).toBe(true)
    expect(groupById.get('A31')).not.toBe(groupById.get('132'))
    expect(groupById.get('A31')!.memberIds).toContain('L01')
  })

  it('draws a complex at its lead, with the union of its routes and stops', () => {
    const times = groupById.get('725')!
    expect(times.pos).toEqual(stations.find((s) => s.id === '725')!.pos)
    expect(times.stops).toEqual(expect.arrayContaining(['127N', 'A27S', 'R16N']))
    expect(times.routeIds).toEqual(expect.arrayContaining(['1', 'A', 'N', '7']))
  })
})
