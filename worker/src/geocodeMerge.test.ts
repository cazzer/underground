import { describe, expect, it } from 'vitest'
import type { Candidate } from './geocodeCandidate'
import { geoSearchCandidates, photonCandidates } from './geocodeFixture'
import { distanceM, hasSatisfyingHit, mergeCandidates } from './geocodeMerge'
import { nameKey, queryTokens } from './geocodeText'
import type { GeocodeKind, GeocodeSource } from './schema'

const labels = (c: Candidate[][], q: string, limit?: number) =>
  mergeCandidates(c, queryTokens(q), limit).map((r) => r.label)

function cand(name: string, lat: number, lon: number, source: GeocodeSource = 'photon', kind: GeocodeKind = 'place'): Candidate {
  return { name, key: nameKey(name), result: { label: name, kind, lat, lon, source } }
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
