import { describe, expect, it } from 'vitest'
import type { Candidate } from './geocodeCandidate'
import { geoSearchCandidates, photonCandidates } from './geocodeFixture'
import { combineRows, distanceM, hasSatisfyingHit, mergeCandidates } from './geocodeMerge'
import { nameKey, queryTokens } from './geocodeText'
import type { GeocodeKind, GeocodeSource } from './schema'

const labels = (c: Candidate[][], q: string, limit?: number) =>
  mergeCandidates(c, queryTokens(q), limit).map((r) => r.label)

function cand(
  name: string,
  lat: number,
  lon: number,
  source: GeocodeSource = 'photon',
  kind: GeocodeKind = 'place',
  address: string | null = null,
): Candidate {
  return { name, key: nameKey(name), address: address && nameKey(address), result: { label: name, kind, lat, lon, source } }
}

describe('nameKey', () => {
  it('folds the usual equivalents', () => {
    expect(nameKey('West 14th Street')).toBe(nameKey('W 14 ST'))
    expect(nameKey("Barclay's")).toBe(nameKey('BARCLAYS'))
    expect(nameKey('Café')).toBe(nameKey('cafe'))
    expect(nameKey('Fish & Chips')).toBe(nameKey('fish and chips'))
    expect(nameKey('1st Avenue')).toBe('1 av')
  })
})

describe('mergeCandidates on the recorded answers', () => {
  it('collapses the Barclays aliases to the plain name', () => {
    expect(labels([geoSearchCandidates('barclays center')], 'barclays center')).toEqual(['BARCLAYS CENTER, Brooklyn'])
  })

  it('collapses the PAD aliases of "120 broadway" to one row per address', () => {
    expect(labels([geoSearchCandidates('120 broadway')], '120 broadway')).toEqual([
      '120 BROADWAY, Manhattan',
      '120 EAST BROADWAY, Manhattan',
      '120 WEST BROADWAY, Manhattan',
    ])
  })

  it('keeps the first list\'s row for a cross-source twin', () => {
    const merged = mergeCandidates(
      [geoSearchCandidates('barclays center'), photonCandidates('barclays center')],
      queryTokens('barclays center'),
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.source).toBe('geosearch')
    const photonFirst = mergeCandidates(
      [photonCandidates('barclays center'), geoSearchCandidates('barclays center')],
      queryTokens('barclays center'),
    )
    expect(photonFirst[0]?.source).toBe('photon')
  })

  it('folds Photon\'s twin nodes but keeps different names at one place', () => {
    const got = labels([photonCandidates('120 broadway')], '120 broadway')
    expect(got.filter((l) => l.startsWith('New York City Department of City Planning'))).toHaveLength(1)
    expect(got).toContain('The Capital Grille, 120 Broadway, Manhattan')
    expect(got).toContain('Crunch Fitness, 120 Broadway, Manhattan')
  })
})

describe('mergeCandidates on synthetic rows', () => {
  it('keeps the same name 300 m apart', () => {
    const a = cand('Joe Pizza', 40.7, -74)
    const b = cand('Joe Pizza', 40.7027, -74)
    expect(distanceM(a.result, b.result)).toBeGreaterThan(250)
    expect(mergeCandidates([[a, b]], ['joe', 'pizza'])).toHaveLength(2)
  })

  it('keeps two branches of a chain 100 m apart when each has its own address, folds one with the same', () => {
    const a = cand('Starbucks', 40.7, -74, 'photon', 'place', '10 Main Street')
    const b = cand('Starbucks', 40.7009, -74, 'photon', 'place', '40 Main Street')
    const twin = cand('Starbucks', 40.70005, -74, 'photon', 'place', '10 Main St')
    const bare = cand('Starbucks', 40.7003, -74, 'geosearch')
    expect(distanceM(a.result, b.result)).toBeLessThan(150)
    expect(mergeCandidates([[a, b]], ['starbucks'])).toHaveLength(2)
    expect(mergeCandidates([[a, twin]], ['starbucks'])).toHaveLength(1)
    // A row with no address of its own cannot tell the branches apart: it folds.
    expect(mergeCandidates([[a, bare]], ['starbucks'])).toHaveLength(1)
  })

  it('prefers the candidate that has the query words (the last may be half typed), then the shorter name', () => {
    const near = cand("120 B'WAY", 40.7, -74, 'geosearch')
    const full = cand('120 BROADWAY', 40.7, -74, 'geosearch')
    expect(labels([[near, full]], '120 broadway')).toEqual(['120 BROADWAY'])
    expect(labels([[near, full]], '120 broad')).toEqual(['120 BROADWAY'])
  })

  it('limits to 8, in the given list order', () => {
    const list = Array.from({ length: 12 }, (_, i) => cand(`Place ${i}`, 40.7 + i * 0.01, -74))
    const rows = mergeCandidates([list], ['place'])
    expect(rows.map((r) => r.label)).toEqual(list.slice(0, 8).map((c) => c.name))
    expect(mergeCandidates([[...list].reverse()], ['place'])[0]?.label).toBe('Place 11')
    expect(labels([list], 'place', 3)).toHaveLength(3)
  })
})

describe('hasSatisfyingHit', () => {
  const kinds = (k: GeocodeKind) => [cand('X', 40.7, -74, 'geosearch', k)]
  it('wants a place or area, or an address for a house-number query', () => {
    expect(hasSatisfyingHit(kinds('place'), 'barclays')).toBe(true)
    expect(hasSatisfyingHit(kinds('area'), 'chelsea')).toBe(true)
    expect(hasSatisfyingHit(kinds('address'), '120 broadway')).toBe(true)
    expect(hasSatisfyingHit(kinds('address'), 'katz')).toBe(false)
    expect(hasSatisfyingHit(kinds('street'), '120 broadway')).toBe(false)
    expect(hasSatisfyingHit([], '120 broadway')).toBe(false)
  })
})

describe('combineRows', () => {
  const street = (name: string) => cand(name, 40.7, -74, 'osm', 'street')
  const up = (n: number) => Array.from({ length: n }, (_, i) => cand(`Up ${i}`, 40.7 + i * 0.01, -74, 'geosearch').result)
  const labelsOf = (rows: { label: string }[]) => rows.map((r) => r.label)

  it('lists whole street rows, then upstream rows, then partial street rows', () => {
    const rows = combineRows({ whole: [street('A')], partial: [street('P')] }, up(2))
    expect(labelsOf(rows)).toEqual(['A', 'Up 0', 'Up 1', 'P'])
  })

  it('keeps at most five whole rows first; the rest wait in front of the partial ones', () => {
    const whole = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6'].map(street)
    expect(labelsOf(combineRows({ whole, partial: [street('P')] }, up(8)))).toEqual(['W0', 'W1', 'W2', 'W3', 'W4', 'Up 0', 'W5', 'W6'])
  })

  it('reserves two places for partial rows, fills the 8 with upstream otherwise, and cuts at 8', () => {
    const partial = ['P0', 'P1', 'P2', 'P3'].map(street)
    expect(labelsOf(combineRows({ whole: [], partial }, up(8)))).toEqual(['Up 0', 'Up 1', 'Up 2', 'Up 3', 'Up 4', 'Up 5', 'P0', 'P1'])
    expect(labelsOf(combineRows({ whole: [], partial: [street('P0')] }, up(8)))).toEqual([...up(7).map((r) => r.label), 'P0'])
    expect(labelsOf(combineRows({ whole: [], partial }, up(2)))).toEqual(['Up 0', 'Up 1', 'P0', 'P1', 'P2', 'P3'])
    expect(combineRows({ whole: [], partial: [] }, up(10))).toHaveLength(8)
  })
})
