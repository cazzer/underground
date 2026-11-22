import { describe, expect, it } from 'vitest'
import { bucketFileName, bucketOf, entryBucketKeys, fnv1a32, GENERIC_TOKENS, queryBucketKey, STREET_BUCKETS } from './searchBucket.ts'
import { searchTokens } from './searchText.ts'

describe('fnv1a32', () => {
  it('matches the published FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })

  it('bucketOf is the hash modulo the bucket count', () => {
    expect(bucketOf('a', STREET_BUCKETS)).toBe(0xe40c292c % 64)
    expect(bucketOf('be', 64)).toBeGreaterThanOrEqual(0)
    expect(bucketOf('be', 64)).toBeLessThan(64)
  })
})

describe('bucketFileName', () => {
  it('is two lowercase hex digits and .json', () => {
    expect(bucketFileName(0)).toBe('00.json')
    expect(bucketFileName(63)).toBe('3f.json')
    expect(bucketFileName(255)).toBe('ff.json')
  })

  it('throws outside 0 to 255 or on a fraction', () => {
    expect(() => bucketFileName(256)).toThrow(/not an integer from 0 to 255/)
    expect(() => bucketFileName(1.5)).toThrow()
    expect(() => bucketFileName(-1)).toThrow()
  })
})

describe('entryBucketKeys', () => {
  it('files a name under its distinctive tokens only', () => {
    expect(entryBucketKeys(['W 40 St'])).toEqual(['40'])
    expect(entryBucketKeys(['Av U'])).toEqual(['u'])
  })

  it('falls back to every token when none is distinctive', () => {
    // "St" is also the start of "saint" and "street", which canonicalize to it.
    expect(entryBucketKeys(['West St'])).toEqual(['sa', 'st', 'w', 'we'])
  })

  it('adds the canonical and long-form spellings', () => {
    const keys = entryBucketKeys(['Mount Eden Av'])
    for (const k of ['mo', 'mt', 'ed']) expect(keys).toContain(k)
  })

  it('files an intersection under the union of both names, sorted and unique', () => {
    const keys = entryBucketKeys(['Bedford Av', 'N 7 St'])
    expect(keys).toEqual([...new Set([...entryBucketKeys(['Bedford Av']), ...entryBucketKeys(['N 7 St'])])].sort())
    expect(keys).toEqual(expect.arrayContaining(['be', '7']))
  })
})

describe('queryBucketKey', () => {
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
    expect(queryBucketKey(query)).toBe(key)
  })

  it('has no key for a query without tokens', () => {
    expect(queryBucketKey('')).toBeNull()
    expect(queryBucketKey('&')).toBeNull()
  })

  it('finds a name in the bucket of every 2+ character prefix of its chosen token', () => {
    const names = [
      'Bedford Av', 'W 40 St', 'N 7 St', 'Broadway', 'Mount Eden Av', 'Mt Hope Pl', 'Atlantic Av', 'Flatbush Av', 'Court St', 'West St',
      'E 14 St', 'Av U', 'Avenue of the Americas', 'Lafayette Court', 'Washington Av', 'Saint Marks Pl', 'Fort Hamilton Pkwy', '5 Av', 'Nostrand Av', 'W 4 St',
    ]
    for (const name of names) {
      const keys = entryBucketKeys([name])
      expect(keys, name).toContain(queryBucketKey(name))
      const tokens = searchTokens(name)
      const chosen = tokens.find((t) => !GENERIC_TOKENS.has(t.canon)) ?? tokens[0]!
      for (let n = 2; n <= chosen.raw.length; n++) expect(keys, `${name}: ${chosen.raw.slice(0, n)}`).toContain(queryBucketKey(chosen.raw.slice(0, n)))
    }
  })
})
