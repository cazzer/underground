import { describe, expect, it } from 'vitest'
import { entryKeys, GENERIC_TOKENS, queryKey } from './streetKeys.ts'
import { searchTokens } from './searchText.ts'

describe('entryKeys', () => {
  it('files a name under its distinctive tokens only', () => {
    expect(entryKeys(['W 40 St'])).toEqual(['40'])
    expect(entryKeys(['Av U'])).toEqual(['u'])
  })

  it('falls back to every token when none is distinctive', () => {
    // "St" is also the start of "saint" and "street", which canonicalize to it.
    expect(entryKeys(['West St'])).toEqual(['sa', 'st', 'w', 'we'])
  })

  it('adds the canonical and long-form spellings', () => {
    const keys = entryKeys(['Mount Eden Av'])
    for (const k of ['mo', 'mt', 'ed']) expect(keys).toContain(k)
  })

  it('files an intersection under the union of both names, sorted and unique', () => {
    const keys = entryKeys(['Bedford Av', 'N 7 St'])
    expect(keys).toEqual([...new Set([...entryKeys(['Bedford Av']), ...entryKeys(['N 7 St'])])].sort())
    expect(keys).toEqual(expect.arrayContaining(['be', '7']))
  })
})

describe('queryKey', () => {
  it.each([
    ['bedf', 'be'],
    ['14 st', '14'],
    ['14t', '14'],
    ['w 4', '4'],
    ['west 40th street', '40'],
    ['n 7 st & bedford', '7'],
    ['bedford av & n 7', 'be'],
    ['mount eden', 'mo'],
    ['mt eden', 'mt'],
    ['west st', 'we'],
  ])('reads %j from the bucket key %j', (query, key) => {
    expect(queryKey(query)).toBe(key)
  })

  it('has no key for a query without tokens', () => {
    expect(queryKey('')).toBeNull()
    expect(queryKey('&')).toBeNull()
  })

  it('finds a name in the bucket of every 2+ character prefix of its chosen token', () => {
    const names = [
      'Bedford Av', 'W 40 St', 'N 7 St', 'Broadway', 'Mount Eden Av', 'Mt Hope Pl', 'Atlantic Av', 'Flatbush Av', 'Court St', 'West St',
      'E 14 St', 'Av U', 'Avenue of the Americas', 'Lafayette Court', 'Washington Av', 'Saint Marks Pl', 'Fort Hamilton Pkwy', '5 Av', 'Nostrand Av', 'W 4 St',
    ]
    for (const name of names) {
      const keys = entryKeys([name])
      expect(keys, name).toContain(queryKey(name))
      const tokens = searchTokens(name)
      const chosen = tokens.find((t) => !GENERIC_TOKENS.has(t.canon)) ?? tokens[0]!
      for (let n = 2; n <= chosen.raw.length; n++) expect(keys, `${name}: ${chosen.raw.slice(0, n)}`).toContain(queryKey(chosen.raw.slice(0, n)))
    }
  })
})
