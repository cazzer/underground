import { describe, expect, it } from 'vitest'
import type { SourceResults } from './geocodeCandidate'
import { geoSearchCandidates, photonCandidates } from './geocodeFixture'
import { geocodeAnswer, logLine, noStreetRows, type SourceOutcome, type StreetRows } from './geocodeOutcome'
import type { GeocodeQuery } from './geocodeQuery'
import { GEOCODE_ATTRIBUTION, type GeocodeResponse, type UpstreamSource } from './schema'
import { searchStreets } from './streetSearch'
import { streetFixture } from './streetFixture'

const query = (text: string): GeocodeQuery => ({ text, focus: null })
const ok = (candidates: SourceResults['candidates'], dropped = 0, outside = 0): SourceOutcome => ({
  status: 'ok',
  results: { candidates, dropped, outside },
  cacheStatus: 'HIT',
})
const failed: SourceOutcome = { status: 'failed', error: 'http-503' }
const answer = (text: string, gs: SourceOutcome, ph: SourceOutcome, photonFirst = false, streets: StreetRows = noStreetRows()) =>
  geocodeAnswer(query(text), { geosearch: gs, photon: ph }, photonFirst, streets)
const body = (a: ReturnType<typeof answer>) => JSON.parse(a.body) as GeocodeResponse

describe('geocodeAnswer', () => {
  it('one ok source and one unneeded is complete and cacheable', () => {
    const a = answer('barclays center', ok(geoSearchCandidates('barclays center')), { status: 'unneeded' })
    expect(a).toMatchObject({ status: 200, cacheable: true, results: 1 })
    expect(body(a)).toMatchObject({ version: 2, incomplete: false, attribution: { geosearch: GEOCODE_ATTRIBUTION.geosearch } })
  })

  it('merges two ok sources, crediting only those with a result', () => {
    const both = answer('120 broadway', ok(geoSearchCandidates('120 broadway')), ok(photonCandidates('120 broadway')))
    expect(Object.keys(body(both).attribution).sort()).toEqual(['geosearch', 'photon'])
    // Photon's twin of Barclays folds into GeoSearch's row, so Photon is not credited.
    const folded = answer('barclays center', ok(geoSearchCandidates('barclays center')), ok(photonCandidates('barclays center')))
    expect(Object.keys(body(folded).attribution)).toEqual(['geosearch'])
    expect(body(folded).results).toHaveLength(1)
  })

  it('puts Photon first when asked', () => {
    const a = answer('barclays center', ok(geoSearchCandidates('barclays center')), ok(photonCandidates('barclays center')), true)
    expect(body(a).results[0]?.source).toBe('photon')
  })

  it('a wanted source that failed, was limited or backed off makes it incomplete and uncacheable', () => {
    const gs = ok(geoSearchCandidates('barclays center'))
    for (const bad of [failed, { status: 'limited' }, { status: 'backoff' }] as SourceOutcome[]) {
      for (const a of [answer('x y z', gs, bad), answer('x y z', bad, gs)]) {
        expect(a).toMatchObject({ status: 200, cacheable: false })
        expect(body(a).incomplete).toBe(true)
      }
    }
  })

  it('answers 502 when every source called failed, 503 when none could be called', () => {
    expect(answer('x y z', failed, failed)).toEqual({ status: 502, body: '{"error":"upstream"}' })
    expect(answer('x y z', failed, { status: 'backoff' })).toEqual({ status: 502, body: '{"error":"upstream"}' })
    expect(answer('x y z', { status: 'limited' }, { status: 'limited' })).toEqual({ status: 503, body: '{"error":"busy"}' })
  })

  it('both ok and empty is a complete, cacheable empty answer', () => {
    const a = answer('zzz', ok([]), ok([]))
    expect(a).toMatchObject({ status: 200, cacheable: true, results: 0 })
    expect(body(a)).toEqual({ version: 2, results: [], attribution: {}, incomplete: false })
  })

  it('results have exactly the five public keys', () => {
    const a = answer('120 broadway', ok(geoSearchCandidates('120 broadway')), { status: 'unneeded' })
    for (const r of body(a).results) expect(Object.keys(r).sort()).toEqual(['kind', 'label', 'lat', 'lon', 'source'])
  })
})

describe('geocodeAnswer with street rows', () => {
  const streets = (text: string) => searchStreets(streetFixture(), query(text))
  const unneeded: SourceOutcome = { status: 'unneeded' }

  it('answers an intersection with both sources unneeded: 200, complete, cacheable, credited to OSM', () => {
    const a = answer('bedford av & n 7', unneeded, unneeded, false, streets('bedford av & n 7'))
    expect(a).toMatchObject({ status: 200, cacheable: true, osm: 1 })
    expect(body(a).results[0]).toMatchObject({ label: 'Bedford Av & N 7 St, Brooklyn', kind: 'intersection', source: 'osm' })
    expect(body(a).attribution).toEqual({ osm: GEOCODE_ATTRIBUTION.osm })
  })

  it('keeps street rows when every upstream failed: 200, incomplete, never cached', () => {
    const a = answer('bedford av', failed, failed, false, streets('bedford av'))
    expect(a).toMatchObject({ status: 200, cacheable: false })
    expect(body(a)).toMatchObject({ incomplete: true, results: [{ label: 'Bedford Av, Brooklyn', kind: 'street' }] })
  })

  it('is 502 or 503 only when there is no street row either', () => {
    expect(answer('x y z', failed, failed, false, streets('qqqq'))).toEqual({ status: 502, body: '{"error":"upstream"}' })
    expect(answer('x y z', { status: 'limited' }, { status: 'limited' }, false, streets('qqqq'))).toMatchObject({ status: 503 })
  })

  it('credits each source that has a row shown, OSM beside GeoSearch', () => {
    const a = answer('broadway', ok(geoSearchCandidates('120 broadway')), unneeded, false, streets('broadway'))
    expect(Object.keys(body(a).attribution).sort()).toEqual(['geosearch', 'osm'])
    expect(body(a).results.slice(0, 3).every((r) => r.source === 'osm')).toBe(true)
  })
})

describe('logLine', () => {
  it('has counts and fixed codes, never a label or the query', () => {
    const outcomes: Record<UpstreamSource, SourceOutcome> = {
      geosearch: ok(geoSearchCandidates('120 broadway'), 2, 1),
      photon: failed,
    }
    const line = logLine('EWR', outcomes, 3, 1)
    expect(JSON.parse(line)).toEqual({
      event: 'geocode-miss',
      colo: 'EWR',
      geosearch: 'ok',
      photon: 'failed:http-503',
      results: 3,
      osm: 1,
      dropped: { geosearch: 2, photon: 0 },
      outside: { geosearch: 1, photon: 0 },
      upstreamCache: { geosearch: 'HIT', photon: null },
    })
    expect(line).not.toMatch(/BROADWAY/i)
  })
})
