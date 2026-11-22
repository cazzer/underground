import { describe, expect, it } from 'vitest'
import { collection, feature, geoSearchCandidates, recordedGeoSearch } from './geocodeFixture'
import { trimGeoSearch } from './geosearch'

describe('trimGeoSearch on the recorded answers', () => {
  it('reads PAD addresses (a house number makes an address)', () => {
    const got = geoSearchCandidates('120 broadway')
    expect(got).toHaveLength(6)
    expect(got.every((c) => c.result.kind === 'address' && c.result.source === 'geosearch')).toBe(true)
    expect(got[0]?.result).toEqual({
      label: '120 BROADWAY, Manhattan',
      kind: 'address',
      lat: 40.70823,
      lon: -74.01054,
      source: 'geosearch',
    })
    expect(got[0]?.key).toBe('120 broadway')
  })

  it('reads a venue without a house number as a place', () => {
    const got = geoSearchCandidates('barclays center')
    expect(got).toHaveLength(10)
    expect(got.every((c) => c.result.kind === 'place')).toBe(true)
  })

  it('reads an empty answer', () => {
    expect(trimGeoSearch(recordedGeoSearch("katz's deli"))).toEqual({ candidates: [], dropped: 0, outside: 0 })
  })
})

describe('trimGeoSearch on synthetic rows', () => {
  const at = { lon: -74, lat: 40.7 }
  const row = (p: Record<string, unknown>) => feature(at.lon, at.lat, p)

  it('counts rows it cannot use as dropped', () => {
    const got = trimGeoSearch(
      collection(
        { type: 'Feature', geometry: null, properties: { name: 'A' } },
        feature(NaN, 40.7, { name: 'B' }),
        feature(Infinity, 40.7, { name: 'B2' }),
        row({ borough: 'Queens' }),
        row({ name: '‮​  ' }),
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0]] }, properties: { name: 'C' } },
        row({ name: 'OK', borough: 'Queens' }),
      ),
    )
    expect(got.dropped).toBe(6)
    expect(got.candidates.map((c) => c.result.label)).toEqual(['OK, Queens'])
  })

  it('counts a point outside the bbox separately and leaves it out', () => {
    const got = trimGeoSearch(collection(feature(-75, 40.7, { name: 'FAR' }), feature(-74, 41.5, { name: 'NORTH' })))
    expect(got).toEqual({ candidates: [], dropped: 0, outside: 2 })
  })

  it('maps layers to kinds', () => {
    const kinds = ['street', 'neighbourhood', 'borough', 'postalcode', 'venue'].map(
      (layer) => trimGeoSearch(collection(row({ name: 'X', layer }))).candidates[0]?.result.kind,
    )
    expect(kinds).toEqual(['street', 'area', 'area', 'area', 'place'])
  })

  it('throws a fixed-message TypeError on a bad shape', () => {
    for (const bad of [null, 'x', [], {}, { features: 'no' }]) {
      expect(() => trimGeoSearch(bad)).toThrow(new TypeError('not a feature collection'))
    }
  })

  it('cleans control and bidi characters and caps a label at 120 code points', () => {
    const got = trimGeoSearch(collection(row({ name: 'A‮B\u0007  C', borough: 'Bronx' }), row({ name: 'x'.repeat(200) })))
    expect(got.candidates[0]?.result.label).toBe('AB C, Bronx')
    expect(Array.from(got.candidates[1]?.result.label ?? '')).toHaveLength(120)
  })
})
