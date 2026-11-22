import { afterEach, describe, expect, it, vi } from 'vitest'
import { GEOCODE_USER_AGENT, fetchCappedJson, fetchGeoSearch, fetchPhoton, geoSearchUrl, photonUrl } from './geocodeUpstream'
import type { GeocodeQuery } from './geocodeQuery'
import { collection, feature } from './geocodeFixture'

const q: GeocodeQuery = { text: "katz's deli", focus: { lat: 40.73, lon: -73.99 } }

afterEach(() => vi.unstubAllGlobals())

const stub = (impl: () => Promise<Response>) => {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init)

describe('URL builders', () => {
  it('builds the GeoSearch autocomplete URL from the normalized text, bbox and rounded focus', () => {
    const url = new URL(geoSearchUrl(q))
    expect(url.origin + url.pathname).toBe('https://geosearch.planninglabs.nyc/v2/autocomplete')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      text: "katz's deli",
      size: '10',
      'boundary.rect.min_lon': '-74.2591',
      'boundary.rect.max_lon': '-73.7004',
      'boundary.rect.min_lat': '40.4774',
      'boundary.rect.max_lat': '40.9176',
      'focus.point.lat': '40.73',
      'focus.point.lon': '-73.99',
    })
  })

  it('builds the Photon URL, with lat and lon only when there is a focus', () => {
    const url = new URL(photonUrl(q))
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "katz's deli",
      limit: '12',
      lang: 'en',
      bbox: '-74.2591,40.4774,-73.7004,40.9176',
      lat: '40.73',
      lon: '-73.99',
    })
    const bare = new URL(photonUrl({ ...q, focus: null })).searchParams
    expect(bare.has('lat') || bare.has('lon')).toBe(false)
    expect(new URL(geoSearchUrl({ ...q, focus: null })).searchParams.has('focus.point.lat')).toBe(false)
  })
})

describe('fetchCappedJson', () => {
  it('returns the parsed body and the cache status, sending only its own headers', async () => {
    const fn = stub(async () => json({ a: 1 }, { headers: { 'cf-cache-status': 'HIT' } }))
    expect(await fetchCappedJson('https://x.example/', 3600)).toEqual({ ok: true, json: { a: 1 }, cacheStatus: 'HIT' })
    const init = fn.mock.calls[0] as unknown as [string, RequestInit & { cf: unknown }]
    expect(init[1].headers).toEqual({ 'User-Agent': GEOCODE_USER_AGENT, Accept: 'application/json' })
    expect(init[1].cf).toEqual({ cacheTtlByStatus: { '200-299': 3600, '400-599': 0 }, cacheEverything: true })
  })

  it('reports an HTTP status as a fixed code', async () => {
    stub(async () => new Response('nope', { status: 503 }))
    expect(await fetchCappedJson('https://x.example/', 1)).toEqual({ ok: false, error: 'http-503', cacheStatus: null })
  })

  it('never reports a thrown error\'s text (it can hold the query)', async () => {
    stub(async () => Promise.reject(new TypeError('fetch failed: https://x.example/?text=katz')))
    expect(await fetchCappedJson('https://x.example/', 1)).toMatchObject({ ok: false, error: 'fetch-failed' })
  })

  it('maps a timeout, an oversize body and a non-JSON body', async () => {
    stub(async () => Promise.reject(new DOMException('timed out', 'TimeoutError')))
    expect(await fetchCappedJson('https://x.example/', 1)).toMatchObject({ error: 'timeout' })
    stub(async () => new Response('x'.repeat(256 * 1024 + 1)))
    expect(await fetchCappedJson('https://x.example/', 1)).toMatchObject({ error: 'too-large' })
    stub(async () => new Response('<html>'))
    expect(await fetchCappedJson('https://x.example/', 1)).toMatchObject({ error: 'parse-failed' })
    stub(async () => new Response(null, { status: 200 }))
    expect(await fetchCappedJson('https://x.example/', 1)).toMatchObject({ error: 'parse-failed' })
  })
})

describe('fetchGeoSearch and fetchPhoton', () => {
  it('trim an answer, and turn a wrong shape into bad-shape', async () => {
    stub(async () => json(collection(feature(-74, 40.7, { name: 'A', borough: 'Queens' }))))
    const ok = await fetchGeoSearch(q)
    expect(ok.status === 'ok' && ok.results.candidates.map((c) => c.result.label)).toEqual(['A, Queens'])
    stub(async () => json({ nothing: true }))
    expect(await fetchPhoton(q)).toEqual({ status: 'failed', error: 'bad-shape' })
  })
})
