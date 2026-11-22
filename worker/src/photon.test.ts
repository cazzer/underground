import { describe, expect, it } from 'vitest'
import { collection, feature, photonCandidates, recordedPhoton } from './geocodeFixture'
import { trimPhoton } from './photon'

const NY = { state: 'New York', countrycode: 'US' }

describe('trimPhoton on the recorded answers', () => {
  it('reads a named business as a place with its street address', () => {
    const got = photonCandidates("katz's deli")
    expect(got).toHaveLength(1)
    expect(got[0]?.result).toEqual({
      label: "Katz's Delicatessen, 205 East Houston Street, Manhattan",
      kind: 'place',
      lat: 40.72234,
      lon: -73.98735,
      source: 'photon',
    })
  })

  it('reads the unnamed place/house as an address', () => {
    const labels = photonCandidates('120 broadway').map((c) => [c.result.label, c.result.kind])
    expect(labels).toContainEqual(['120 Broadway, Manhattan', 'address'])
    expect(labels).toContainEqual(['Equitable Building, 120 Broadway, Manhattan', 'place'])
    expect(labels).toContainEqual(['120 East Broadway, Manhattan', 'address'])
  })

  it('drops the railway rows and keeps the stadium', () => {
    const answer = trimPhoton(recordedPhoton('barclays center'))
    expect(answer.dropped).toBe(7)
    expect(answer.candidates.map((c) => c.result.label)).toEqual(['Barclays Center, 620 Atlantic Avenue, Brooklyn'])
  })
})

describe('trimPhoton on synthetic rows', () => {
  const at = (p: Record<string, unknown>) => feature(-74, 40.7, { ...NY, ...p })

  it('drops rows from another state or country, and transit rows', () => {
    const got = trimPhoton(
      collection(
        at({ name: 'Hoboken Cafe', state: 'New Jersey' }),
        at({ name: 'Elsewhere', countrycode: 'CA' }),
        at({ name: 'Metro', osm_key: 'public_transport', osm_value: 'platform' }),
        at({ name: 'Stop', osm_key: 'railway' }),
        at({ name: 'Bus Stop', osm_key: 'highway', osm_value: 'bus_stop' }),
        at({ name: 'Open Cafe', osm_key: 'amenity', district: 'Queens' }),
        feature(-74, 40.7, { name: 'No State Cafe', city: 'New York' }),
      ),
    )
    expect(got.dropped).toBe(5)
    expect(got.candidates.map((c) => c.result.label)).toEqual(['Open Cafe, Queens', 'No State Cafe, New York'])
    // Other highway rows are wanted.
    const street = at({ name: 'Main St', type: 'street', osm_key: 'highway', osm_value: 'residential' })
    expect(trimPhoton(collection(street)).candidates).toHaveLength(1)
  })

  it('reads streets and areas, and needs both parts of an unnamed address', () => {
    const got = trimPhoton(
      collection(
        at({ type: 'street', name: 'Broadway', district: 'Manhattan' }),
        at({ type: 'district', name: 'Chelsea', city: 'New York' }),
        at({ type: 'house', housenumber: '5', district: 'Bronx' }),
        at({ type: 'house', street: 'Main St' }),
        at({ type: 'street' }),
      ),
    )
    expect(got.candidates.map((c) => [c.result.label, c.result.kind])).toEqual([
      ['Broadway, Manhattan', 'street'],
      ['Chelsea, New York', 'area'],
    ])
    expect(got.dropped).toBe(3)
  })

  it('counts a point outside the bbox and throws a fixed TypeError on a bad shape', () => {
    expect(trimPhoton(collection(feature(-80, 40.7, { ...NY, name: 'Far' }))).outside).toBe(1)
    expect(() => trimPhoton({ features: null })).toThrow(new TypeError('not a feature collection'))
  })
})
