import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expectAmenities } from './loadAmenities'

const URL = 'data/stations/amenities.json'

const file = (stations: unknown) => ({
  format: 1,
  attribution: 'MTA',
  restroomsUpdatedAt: '2026-11-01T04:19:26.000Z',
  restroomsMonth: '2026-10-01',
  cscRetrievedAt: '2026-11-26',
  stations,
})

describe('expectAmenities', () => {
  it('accepts the committed file', () => {
    const raw: unknown = JSON.parse(readFileSync('public/data/stations/amenities.json', 'utf8'))
    expect(Object.keys(expectAmenities(raw, URL).stations).length).toBeGreaterThan(0)
  })

  it('accepts a restroom, a customer service center or both', () => {
    const stations = { '142': { restrooms: 2 }, '120': { csc: { entrance: 'Enter at 95 St and Broadway' } }, '631': { restrooms: 1, csc: { entrance: 'Enter at 42 St and Park Av' } } }
    expect(expectAmenities(file(stations), URL).stations).toEqual(stations)
  })

  it('rejects a wrong format or missing text fields', () => {
    expect(() => expectAmenities(null, URL)).toThrow(/not an object/)
    expect(() => expectAmenities({ ...file({}), format: 2 }, URL)).toThrow(/format is 2/)
    expect(() => expectAmenities({ ...file({}), attribution: 3 }, URL)).toThrow(/attribution/)
    expect(() => expectAmenities({ ...file({}), stations: [] }, URL)).toThrow(/no stations object/)
  })

  it('rejects a bad entry', () => {
    expect(() => expectAmenities(file({ A: 1 }), URL)).toThrow(/station A is not an object/)
    expect(() => expectAmenities(file({ A: { restrooms: 0 } }), URL)).toThrow(/restrooms 0/)
    expect(() => expectAmenities(file({ A: { restrooms: 1.5 } }), URL)).toThrow(/restrooms 1.5/)
    expect(() => expectAmenities(file({ A: { restrooms: '1' } }), URL)).toThrow(/restrooms "1"/)
    expect(() => expectAmenities(file({ A: { csc: {} } }), URL)).toThrow(/no entrance text/)
    expect(() => expectAmenities(file({ A: { csc: { entrance: '' } } }), URL)).toThrow(/no entrance text/)
    expect(() => expectAmenities(file({ A: {} }), URL)).toThrow(/lists no amenity/)
  })
})
