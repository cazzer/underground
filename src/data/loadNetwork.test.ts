import { describe, expect, it } from 'vitest'
import { expectDataFile } from './loadNetwork'

const URL = '/underground/data/stations.json'

describe('expectDataFile', () => {
  it('returns a well-formed file unchanged', () => {
    const raw = { feedVersion: 'v1', stations: [] }
    expect(expectDataFile(raw, 'stations', URL)).toBe(raw)
  })

  it('throws, naming the url, for null', () => {
    expect(() => expectDataFile(null, 'stations', URL)).toThrow(`${URL}: not a stations file`)
  })

  it('throws without a string feedVersion', () => {
    expect(() => expectDataFile({ stations: [] }, 'stations', URL)).toThrow(URL)
    expect(() => expectDataFile({ feedVersion: 3, stations: [] }, 'stations', URL)).toThrow(URL)
  })

  it('throws when the key is not an array', () => {
    expect(() => expectDataFile({ feedVersion: 'v1', stations: {} }, 'stations', URL)).toThrow(URL)
    expect(() => expectDataFile({ feedVersion: 'v1', routes: [] }, 'stations', URL)).toThrow(URL)
  })
})
