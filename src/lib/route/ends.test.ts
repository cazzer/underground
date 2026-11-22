import { describe, expect, it } from 'vitest'
import { complexMembers } from './ends'

const complexes = [
  ['L03', '635', 'R20'],
  ['725', '127', '902', 'A27', 'R16'],
]

describe('complexMembers', () => {
  it('gathers the complex, the chosen one first and the rest by id', () => {
    expect(complexMembers(complexes, 'R20')).toEqual(['R20', '635', 'L03'])
    expect(complexMembers(complexes, '725')).toEqual(['725', '127', '902', 'A27', 'R16'])
  })
  it('leaves a station in no complex alone, and an unknown id', () => {
    expect(complexMembers(complexes, 'A01')).toEqual(['A01'])
    expect(complexMembers([], 'ZZ')).toEqual(['ZZ'])
  })
})
