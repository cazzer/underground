import { describe, expect, it } from 'vitest'
import type { AlertEntity, ServiceAlert } from '../../data/realtime'
import type { TripPattern } from '../../data/schema'
import type { Station } from '../network'
import { addedSetsOf, serviceIndex, type PatternSource } from './alertAdded'

const station = (id: string, name = id, leadId = id): Station => ({
  id,
  name,
  pos: { x: 0, z: 0 },
  routeIds: ['X'],
  stops: [`${id}N`, `${id}S`],
  access: { status: 'none' },
  leadId,
})
// B2 shares B's complex; L is a stop no X pattern calls at.
const stations = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'L'].map((id) => station(id, `${id} St`)).concat(station('B2', 'B2 St', 'B'))
const stationById = new Map(stations.map((s) => [s.id, s]))
const pattern = (direction: 'N' | 'S', ...ids: string[]): TripPattern => ({ routeId: 'X', direction, stops: ids.map((id) => `${id}${direction}`) })
const src: PatternSource = {
  patterns: {
    'X..N1': pattern('N', 'A', 'B', 'D', 'E'),
    // A night local: C between B and D, which the primary calls at one after the other.
    'X..N2': pattern('N', 'A', 'B', 'C', 'D', 'E'),
    // A branch off B: F and G have no primary station after them.
    'X..N3': pattern('N', 'A', 'B', 'F', 'G'),
    // A short way round from A to E: H lies between stations the primary doesn't call at in a row.
    'X..N4': pattern('N', 'A', 'H', 'E'),
    'X..S1': pattern('S', 'E', 'D', 'B', 'A'),
  },
  primary: new Map([
    ['X|N', 'X..N1'],
    ['X|S', 'X..S1'],
  ]),
}
const serviceOf = serviceIndex(src, stationById)
const normal = (d: 'N' | 'S') => [...serviceOf('X', d)!.normal].sort()

const at = (stop: string, direction: 'N' | 'S' | null = 'N', route = 'X'): AlertEntity => ({ route, stop, direction })
const local = (header: string, entities: AlertEntity[]): ServiceAlert => ({ id: 'a', type: 'Planned - Express to Local', header, periods: [[0, null]], entities })
const added = (a: ServiceAlert) => addedSetsOf(a, { stationById, serviceOf }).map((s) => `${s.route}${s.direction}:${[...s.stations].sort().join(',')}`)

describe('serviceIndex', () => {
  it('counts the primary, branches and other ways round as normal, not a stop the primary runs past', () => {
    expect(normal('N')).toEqual(['A', 'B', 'B2', 'D', 'E', 'F', 'G', 'H'])
    expect(serviceOf('X', 'N')!.primary).toEqual(['A', 'B', 'D', 'E'])
  })

  it('makes a complex whole: a member of a normal station is normal too', () => {
    expect(normal('S')).toContain('B2')
  })

  it('has nothing for a route and direction with no primary', () => {
    expect(serviceOf('Y', 'N')).toBeNull()
  })
})

describe('addedSetsOf', () => {
  it('adds the informed stops the route runs past or never calls at, not those it calls at', () => {
    expect(added(local('[X] runs local from A St to E St', [at('A'), at('B'), at('C'), at('D'), at('L'), at('E')]))).toEqual(['XN:C,L'])
  })

  it('reads an entity with no direction for both directions, a set each', () => {
    expect(added(local('[X] runs local', [at('C', null), at('B', null)]))).toEqual(['XN:C', 'XS:C'])
  })

  it('narrows to the stops the header says trains stop at', () => {
    expect(added(local('All [X] trains stop at C St', [at('B'), at('C'), at('L')]))).toEqual(['XN:C'])
  })

  it('ignores a "from ... to" stretch: its ends are not stops', () => {
    expect(added(local('[X] runs local from C St to L St', [at('C'), at('L')]))).toEqual(['XN:C,L'])
  })

  it('keeps every added stop when the header names none of them', () => {
    expect(added(local('All [X] trains stop at B St', [at('B'), at('C')]))).toEqual(['XN:C'])
  })

  it('has no set for a route with no primary, nothing added, or another kind of change', () => {
    expect(added(local('[Y] runs local', [at('C', 'N', 'Y')]))).toEqual([])
    expect(added(local('[X] runs local', [at('A'), at('B')]))).toEqual([])
    expect(added({ ...local('[X] skips C St', [at('C')]), type: 'Planned - Stops Skipped' })).toEqual([])
  })
})
