import { describe, expect, it } from 'vitest'
import { matchName, typedTokens } from './nameMatch.ts'
import { searchTokens } from './searchText.ts'

const match = (query: string, name: string, partialLast = true) => matchName(typedTokens(query), searchTokens(name), partialLast)

describe('typedTokens', () => {
  it('reads a half-typed ordinal as a bare number', () => {
    expect(typedTokens('14t').map((t) => t.raw)).toEqual(['14'])
    expect(typedTokens('14th').map((t) => [t.raw, t.ordinal])).toEqual([['14', true]])
  })
})

describe('matchName', () => {
  it('scores zero when a query word matches nothing', () => {
    expect(match('bedford zzz', 'Bedford Av')).toEqual({ score: 0, whole: false })
  })

  it('says whether every word of the name was matched', () => {
    expect(match('bedford av', 'Bedford Av').whole).toBe(true)
    expect(match('bedford avenue', 'Bedford Av').whole).toBe(true)
    expect(match('bedford', 'Bedford Av').whole).toBe(false)
    expect(match('bedford', 'Bedford Av').score).toBeGreaterThan(0)
  })

  it('ranks an exact word above a prefix, and a whole name above a longer one', () => {
    expect(match('bedford av', 'Bedford Av').score).toBeGreaterThan(match('bedf av', 'Bedford Av').score)
    expect(match('w 4', 'W 4 St').score).toBeGreaterThan(match('w 4', 'W 40 St').score)
    expect(match('broadway', 'Broadway').score).toBeGreaterThan(match('broadway', 'Broadway Junction').score)
  })

  it('lets a number start a longer one only when the last word is half typed', () => {
    expect(match('w 4', 'W 40 St').score).toBeGreaterThan(0)
    expect(match('w 4', 'W 40 St', false).score).toBe(0)
    expect(match('w 4', 'W 4 St', false).score).toBeGreaterThan(0)
  })

  it('does not half-type a long form of the last word when it is finished', () => {
    expect(match('bedford stre', 'Bedford St').score).toBeGreaterThan(0)
    expect(match('bedford stre', 'Bedford St', false).score).toBe(0)
  })
})
