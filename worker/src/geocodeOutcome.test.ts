import { describe, expect, it } from 'vitest'
import type { SourceResults } from './geocodeCandidate'
import { geoSearchCandidates, photonCandidates } from './geocodeFixture'
import { geocodeAnswer, logLine, type SourceOutcome } from './geocodeOutcome'
import type { GeocodeQuery } from './geocodeQuery'
import { GEOCODE_ATTRIBUTION, type GeocodeResponse, type GeocodeSource } from './schema'

const query = (text: string): GeocodeQuery => ({ text, focus: null })
const ok = (candidates: SourceResults['candidates'], dropped = 0, outside = 0): SourceOutcome => ({
  status: 'ok',
  results: { candidates, dropped, outside },
  cacheStatus: 'HIT',
})
const failed: SourceOutcome = { status: 'failed', error: 'http-503' }
const answer = (text: string, gs: SourceOutcome, ph: SourceOutcome, photonFirst = false) =>
  geocodeAnswer(query(text), { geosearch: gs, photon: ph }, photonFirst)
const body = (a: ReturnType<typeof answer>) => JSON.parse(a.body) as GeocodeResponse

describe('geocodeAnswer', () => {
  it('one ok source and one unneeded is complete and cacheable', () => {
    const a = answer('barclays center', ok(geoSearchCandidates('barclays center')), { status: 'unneeded' })
    expect(a).toMatchObject({ status: 200, cacheable: true, results: 1 })
    expect(body(a)).toMatchObject({ version: 1, incomplete: false, attribution: { geosearch: GEOCODE_ATTRIBUTION.geosearch } })
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
    expect(body(a)).toEqual({ version: 1, results: [], attribution: {}, incomplete: false })
  })

  it('results have exactly the five public keys', () => {
    const a = answer('120 broadway', ok(geoSearchCandidates('120 broadway')), { status: 'unneeded' })
    for (const r of body(a).results) expect(Object.keys(r).sort()).toEqual(['kind', 'label', 'lat', 'lon', 'source'])
  })
})

describe('logLine', () => {
  it('has counts and fixed codes, never a label or the query', () => {
    const outcomes: Record<GeocodeSource, SourceOutcome> = {
      geosearch: ok(geoSearchCandidates('120 broadway'), 2, 1),
      photon: failed,
    }
    const line = logLine('EWR', outcomes, 3)
    expect(JSON.parse(line)).toEqual({
      event: 'geocode-miss',
      colo: 'EWR',
      geosearch: 'ok',
      photon: 'failed:http-503',
      results: 3,
      dropped: { geosearch: 2, photon: 0 },
      outside: { geosearch: 1, photon: 0 },
      upstreamCache: { geosearch: 'HIT', photon: null },
    })
    expect(line).not.toMatch(/BROADWAY/i)
  })
})
