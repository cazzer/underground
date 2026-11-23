import { describe, expect, it } from 'vitest'
import type { GeocodeQuery } from './geocodeQuery'
import { streetFixture } from './streetFixture'
import { searchStreets } from './streetSearch'

const index = streetFixture()
const q = (text: string, focus: GeocodeQuery['focus'] = null): GeocodeQuery => ({ text, focus })
const found = (text: string, focus: GeocodeQuery['focus'] = null) => {
  const { whole, partial } = searchStreets(index, q(text, focus))
  return { whole: whole.map((c) => c.result.label), partial: partial.map((c) => c.result.label) }
}

describe('searchStreets: streets', () => {
  it('finds a street by its whole name, in every borough that has it', () => {
    expect(found('broadway').whole).toEqual(['Broadway, Manhattan', 'Broadway, Brooklyn', 'Broadway, Queens'])
  })

  it('puts the borough nearest the focus first, then the higher class, then the label', () => {
    expect(found('broadway', { lat: 40.7, lon: -73.94 }).whole[0]).toBe('Broadway, Brooklyn')
    expect(found('broadway', { lat: 40.756, lon: -73.92 }).whole[0]).toBe('Broadway, Queens')
    // No focus: the three tie on score, so the class decides (Manhattan 4, Brooklyn and Queens 3), then the label.
    expect(found('broadway').whole).toEqual(['Broadway, Manhattan', 'Broadway, Brooklyn', 'Broadway, Queens'])
  })

  it('answers with the site nearest the focus, else the street\'s middle site', () => {
    const [near] = searchStreets(index, q('broadway', { lat: 40.8, lon: -73.97 })).whole
    expect(near?.result).toMatchObject({ label: 'Broadway, Manhattan', lat: 40.8, lon: -73.97 })
    const manhattan = searchStreets(index, q('broadway')).whole.find((c) => c.result.label === 'Broadway, Manhattan')
    expect(manhattan?.result).toMatchObject({ lat: 40.7589, lon: -73.9851 })
  })

  it('separates a spelled-out name from a half-typed one', () => {
    expect(found('bedford av')).toEqual({ whole: ['Bedford Av, Brooklyn'], partial: [] })
    expect(found('bedford')).toEqual({ whole: [], partial: ['Bedford Av, Brooklyn'] })
    expect(found('w 40').partial).toEqual(['W 40 St, Manhattan'])
  })

  it('reads spellings and typos the station search does', () => {
    expect(found('west 40th street').whole).toEqual(['W 40 St, Manhattan'])
    expect(found('bedfrod avenue').whole).toEqual(['Bedford Av, Brooklyn'])
    expect(found('avenue u').whole).toEqual(['Av U, Brooklyn'])
  })

  it('writes rows as "Name, Borough", kind street, source osm, with an empty address', () => {
    const [row] = searchStreets(index, q('n 7 st')).whole
    expect(row?.result).toEqual({ label: 'N 7 St, Brooklyn', kind: 'street', lat: 40.7185, lon: -73.9577, source: 'osm' })
    expect(row?.name).toBe('N 7 St')
    expect(row?.address).toBeNull()
  })

  it('finds nothing for text that matches no street', () => {
    expect(found('zzzz street')).toEqual({ whole: [], partial: [] })
  })
})

describe('searchStreets: intersections', () => {
  it('finds a crossing in either typed order, labelled in the index order', () => {
    const want = ['Bedford Av & N 7 St, Brooklyn']
    expect(found('bedford av & n 7 st').whole).toEqual(want)
    expect(found('n 7 st & bedford av').whole).toEqual(want)
    expect(found('n 7 st and bedford av').whole).toEqual(want)
    expect(found('bedford av at n 7').partial).toEqual(want)
  })

  it('writes the intersection row with kind intersection and the crossing\'s point', () => {
    const [row] = searchStreets(index, q('bedford av & n 7 st')).whole
    expect(row?.result).toEqual({ label: 'Bedford Av & N 7 St, Brooklyn', kind: 'intersection', lat: 40.71784, lon: -73.95773, source: 'osm' })
    expect(row?.name).toBe('Bedford Av & N 7 St')
  })

  it('takes the half-typed side after the separator', () => {
    expect(found('bedford av & n 6').partial).toEqual(['Bedford Av & N 6 St, Brooklyn'])
    expect(found('bedford & n 7').partial).toEqual(['Bedford Av & N 7 St, Brooklyn'])
  })

  it('keeps one row for two crossings of the same pair, the one nearer the focus', () => {
    const rows = searchStreets(index, q('broadway & w 40 st', { lat: 40.7551, lon: -73.9866 })).whole
    expect(rows.map((c) => c.result.label)).toEqual(['Broadway & W 40 St, Manhattan'])
    expect(rows[0]?.result).toMatchObject({ lat: 40.7551, lon: -73.9866 })
    expect(searchStreets(index, q('broadway & w 40 st')).whole[0]?.result).toMatchObject({ lat: 40.7549, lon: -73.9862 })
  })

  it('does not join streets that do not cross, or that sit in different boroughs', () => {
    expect(found('bedford av & w 40 st')).toEqual({ whole: [], partial: [] })
    expect(found('broadway & n 7 st')).toEqual({ whole: [], partial: [] })
  })

  it('still finds a street whose own name holds the separator, through the whole text', () => {
    expect(found('g & h av').whole).toEqual(['G & H Av, Brooklyn'])
  })

  it('needs a separator: two street names alone are not a crossing', () => {
    expect(found('bedford av n 7 st')).toEqual({ whole: [], partial: [] })
  })
})
