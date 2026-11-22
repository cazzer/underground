import { describe, expect, it } from 'vitest'
import { complexMembers } from './ends'

const stations = [
  { id: 'A1', name: 'Union Sq' },
  { id: 'A2', name: 'Union Sq' },
  { id: 'A3', name: 'Union Sq' },
  { id: 'B1', name: 'Union Sq' },
  { id: 'C1', name: 'Other' },
]

describe('complexMembers', () => {
  it('gathers same-named stations linked by transfers, the chosen one first', () => {
    const transfers = [
      { from: 'A2', to: 'A1' },
      { from: 'A1', to: 'A2' },
      { from: 'A3', to: 'A2' },
    ]
    expect(complexMembers(stations, 'A2', transfers)).toEqual(['A2', 'A1', 'A3'])
    expect(complexMembers(stations, 'A3', transfers)).toEqual(['A3', 'A1', 'A2'])
  })
  it('leaves out a same-named station with no transfer to the complex', () => {
    expect(complexMembers(stations, 'A1', [{ from: 'A1', to: 'A2' }])).toEqual(['A1', 'A2'])
    expect(complexMembers(stations, 'B1', [{ from: 'A1', to: 'A2' }])).toEqual(['B1'])
  })
  it('ignores transfers to differently named stations', () => {
    expect(complexMembers(stations, 'A1', [{ from: 'A1', to: 'C1' }])).toEqual(['A1'])
  })
  it('returns an unknown id alone', () => {
    expect(complexMembers(stations, 'ZZ', [])).toEqual(['ZZ'])
  })
})
