import { describe, expect, it } from 'vitest'
import { siteFor, splitCrossing } from './streetQuery'

describe('splitCrossing', () => {
  it.each([
    ['bedford av & n 7 st', ['bedford av', 'n 7 st']],
    ['bedford av&n 7', ['bedford av', 'n 7']],
    ['bedford av and n 7 st', ['bedford av', 'n 7 st']],
    ['bedford av at n 7 st', ['bedford av', 'n 7 st']],
    ['bedford av / n 7 st', ['bedford av', 'n 7 st']],
    ['bedford av @ n 7 st', ['bedford av', 'n 7 st']],
    ['bedford av + n 7 st', ['bedford av', 'n 7 st']],
  ])('splits %j', (text, sides) => {
    expect(splitCrossing(text)).toEqual(sides)
  })

  it('splits at the first separator only', () => {
    expect(splitCrossing('a & b & c')).toEqual(['a', 'b & c'])
  })

  it('does not split on a word that only contains "and" or "at"', () => {
    expect(splitCrossing('grand army plaza')).toBeNull()
    expect(splitCrossing('atlantic av')).toBeNull()
    expect(splitCrossing('bedford av')).toBeNull()
  })

  it('has no split when a side is empty', () => {
    expect(splitCrossing('bedford av &')).toBeNull()
    expect(splitCrossing('& n 7 st')).toBeNull()
    expect(splitCrossing('bedford and')).toBeNull()
  })
})

describe('siteFor', () => {
  const sites: [number, number][] = [
    [40.6, -74.0],
    [40.7, -73.95],
    [40.8, -73.9],
  ]

  it('takes the site nearest the focus', () => {
    expect(siteFor(sites, { lat: 40.79, lon: -73.9 })).toEqual([40.8, -73.9])
    expect(siteFor(sites, { lat: 40.5, lon: -74.1 })).toEqual([40.6, -74.0])
  })

  it('takes the middle site (nearest the mean) with no focus', () => {
    expect(siteFor(sites, null)).toEqual([40.7, -73.95])
    expect(siteFor([[40.6, -74.0]], null)).toEqual([40.6, -74.0])
  })

  it('throws on a street with no site', () => {
    expect(() => siteFor([], null)).toThrow(RangeError)
  })
})
