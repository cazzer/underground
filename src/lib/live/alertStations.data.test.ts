/** Header-name matching over the committed stations: an item names its own station and no neighbour that shares words. */
import { describe, expect, it } from 'vitest'
import { realStations } from '../realGroups.testdata'
import { headerNamedStations } from './alertStations'

describe('headerNamedStations on every station of every route', () => {
  const routes = [...new Set(realStations.flatMap((s) => s.routeIds))]

  it('"[R] skips <name>" names the stations of that name and no other, for every station of every route', () => {
    const wrong: string[] = []
    let checked = 0
    for (const route of routes) {
      const candidates = realStations.filter((s) => s.routeIds.includes(route)).map((s) => ({ id: s.id, name: s.name }))
      const byId = new Map(candidates.map((c) => [c.id, c.name]))
      for (const own of candidates) {
        checked++
        const named = [...headerNamedStations(`In Brooklyn, [${route}] skips ${own.name}`, candidates)]
        const others = named.map((id) => byId.get(id)!).filter((name) => name !== own.name)
        if (!named.includes(own.id) || others.length > 0) wrong.push(`${route} "${own.name}" -> ${named.map((id) => byId.get(id)).join(' / ')}`)
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(wrong).toEqual([])
  })

  it('reads a list: each item names only its own station', () => {
    const candidates = realStations.filter((s) => s.routeIds.includes('2')).map((s) => ({ id: s.id, name: s.name }))
    const named = [...headerNamedStations('Manhattan-bound [2] skips 3 Av-149 St, Jackson Av and 149 St-Hostos', candidates)].map((id) => candidates.find((c) => c.id === id)!.name)
    expect(named.sort()).toEqual(['149 St-Hostos', '3 Av-149 St', 'Jackson Av'])
  })
})
