import { describe, expect, it } from 'vitest'
import { parseStationHash, stationHashUrl } from './stationHash'

describe('parseStationHash', () => {
  it('reads the station id', () => {
    expect(parseStationHash('#station=L08')).toBe('L08')
    expect(parseStationHash('station=127')).toBe('127')
  })
  it('finds it among other parameters', () => {
    expect(parseStationHash('#a=1&station=R16&b=2')).toBe('R16')
  })
  it('trims and decodes', () => {
    expect(parseStationHash('#station=%20L08%20')).toBe('L08')
    expect(parseStationHash('#station=A%2FB')).toBe('A/B')
  })
  it('is null when absent or empty', () => {
    expect(parseStationHash('')).toBeNull()
    expect(parseStationHash('#')).toBeNull()
    expect(parseStationHash('#station=')).toBeNull()
    expect(parseStationHash('#station=%20')).toBeNull()
    expect(parseStationHash('#other=1')).toBeNull()
  })
})

describe('stationHashUrl', () => {
  const loc = { pathname: '/underground/', search: '?theme=blueprint&lines=a' }
  it('keeps the path and query and sets the hash', () => {
    expect(stationHashUrl(loc, 'L08')).toBe('/underground/?theme=blueprint&lines=a#station=L08')
  })
  it('drops the hash for no station', () => {
    expect(stationHashUrl(loc, null)).toBe('/underground/?theme=blueprint&lines=a')
    expect(stationHashUrl({ pathname: '/underground/', search: '' }, null)).toBe('/underground/')
  })
  it('encodes the id so it round-trips', () => {
    const url = stationHashUrl({ pathname: '/', search: '' }, 'A&B=C')
    expect(parseStationHash(url.slice(url.indexOf('#')))).toBe('A&B=C')
  })
})
