import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGeocode, geocodeRequestUrl, parseGeocodeResponse } from './geocodeFetch'
import { geocodeUrlFrom } from './realtime'
import { SchemaMismatchError } from './realtimeFetch'

const row = { label: '120 BROADWAY, Manhattan', kind: 'address', lat: 40.7075, lon: -74.0113, source: 'geosearch' }
const valid = () => ({ version: 2, results: [row], attribution: { geosearch: 'NYC GeoSearch' }, incomplete: false })

describe('geocodeRequestUrl', () => {
  it('encodes the query and puts the focus at two decimals', () => {
    const url = new URL(geocodeRequestUrl('http://w/geocode', "katz's deli & more", { lat: 40.7312, lon: -73.9899 }))
    expect(url.searchParams.get('q')).toBe("katz's deli & more")
    expect(url.searchParams.get('focus')).toBe('40.73,-73.99')
    expect(url.search).not.toContain("'")
  })

  it('has no focus parameter without one', () => {
    expect(new URL(geocodeRequestUrl('http://w/geocode', '120 broadway', null)).searchParams.has('focus')).toBe(false)
  })
})

describe('parseGeocodeResponse', () => {
  it('accepts a valid body', () => {
    expect(parseGeocodeResponse(valid()).results[0]).toEqual(row)
  })

  it('accepts the street index\'s rows: kinds street and intersection, source osm', () => {
    const rows = [
      { label: 'Bedford Av & N 7 St, Brooklyn', kind: 'intersection', lat: 40.71784, lon: -73.95773, source: 'osm' },
      { label: 'Broadway, Manhattan', kind: 'street', lat: 40.7589, lon: -73.9851, source: 'osm' },
    ]
    const body = { ...valid(), results: rows, attribution: { osm: '© OpenStreetMap contributors' } }
    expect(parseGeocodeResponse(body).results).toEqual(rows)
  })

  it('reads a v1 body as v2 (a Worker not yet deployed), and throws SchemaMismatchError for any other version', () => {
    const v1 = parseGeocodeResponse({ ...valid(), version: 1, results: [{ ...row, kind: 'street' }] })
    expect(v1).toMatchObject({ version: 2, results: [{ kind: 'street', source: 'geosearch' }] })
    for (const version of [0, 3, '2', null]) expect(() => parseGeocodeResponse({ ...valid(), version })).toThrow(SchemaMismatchError)
  })

  it.each([
    ['a bad kind', { ...row, kind: 'poi' }],
    ['a bad source', { ...row, source: 'google' }],
    ['a NaN lat', { ...row, lat: NaN }],
    ['a lat outside the city', { ...row, lat: 41.5 }],
    ['a lon outside the city', { ...row, lon: -80 }],
    ['an empty label', { ...row, label: '' }],
  ])('rejects %s, with a message that holds no label', (_name, bad) => {
    const labeled = { ...bad, label: bad.label === '' ? '' : 'SECRET LABEL' }
    expect(() => parseGeocodeResponse({ ...valid(), results: [labeled] })).toThrow(/place 0/)
    try {
      parseGeocodeResponse({ ...valid(), results: [labeled] })
    } catch (err) {
      expect(String(err)).not.toContain('SECRET')
    }
  })

  it('rejects a ninth row, a missing incomplete flag and bad attribution', () => {
    expect(() => parseGeocodeResponse({ ...valid(), results: Array.from({ length: 9 }, () => row) })).toThrow('results')
    expect(() => parseGeocodeResponse({ ...valid(), incomplete: undefined })).toThrow('incomplete')
    expect(() => parseGeocodeResponse({ ...valid(), attribution: { geosearch: 3 } })).toThrow('attribution')
  })
})

describe('fetchGeocode', () => {
  afterEach(() => vi.unstubAllGlobals())
  const signal = () => new AbortController().signal
  const stub = (res: () => Response) => {
    const fn = vi.fn(async () => res())
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('returns the response, asking with no-store and no credentials', async () => {
    const fn = stub(() => new Response(JSON.stringify(valid())))
    expect(await fetchGeocode('http://w/geocode?q=120', signal())).toMatchObject({ ok: true, response: { results: [row] } })
    expect(fn).toHaveBeenCalledWith('http://w/geocode?q=120', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }))
  })

  it.each([
    [503, 'busy'],
    [429, 'busy'],
    [502, 'upstream'],
    [500, 'upstream'],
    [400, 'rejected'],
    [403, 'rejected'],
    [404, 'upstream'],
  ])('maps HTTP %i to %s', async (status, error) => {
    stub(() => new Response('{}', { status }))
    expect(await fetchGeocode('http://w/geocode?q=120', signal())).toEqual({ ok: false, error, status })
  })

  it('maps a non-JSON body, a wrong shape, a version change, a timeout and a network error', async () => {
    stub(() => new Response('<html>'))
    expect(await fetchGeocode('http://w/g', signal())).toMatchObject({ ok: false, error: 'bad-response' })
    stub(() => new Response(JSON.stringify({ ...valid(), results: 'no' })))
    expect(await fetchGeocode('http://w/g', signal())).toMatchObject({ ok: false, error: 'bad-response' })
    stub(() => new Response(JSON.stringify({ ...valid(), version: 3 })))
    expect(await fetchGeocode('http://w/g', signal())).toMatchObject({ ok: false, error: 'schema' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('slow', 'TimeoutError'))))
    expect(await fetchGeocode('http://w/g', signal())).toMatchObject({ ok: false, error: 'timeout' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch http://w/geocode?q=zqxsecret'))))
    const answer = await fetchGeocode('http://w/geocode?q=zqxsecret', signal())
    expect(answer).toMatchObject({ ok: false, error: 'network' })
    expect(JSON.stringify(answer)).not.toContain('zqxsecret')
  })

  it('throws only for the caller own abort', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))))
    controller.abort()
    await expect(fetchGeocode('http://w/g', controller.signal)).rejects.toThrow()
  })
})

describe('geocodeUrlFrom', () => {
  it('is a sibling of the /rt URL, with or without a trailing slash', () => {
    expect(geocodeUrlFrom('http://localhost:8787/rt')).toBe('http://localhost:8787/geocode')
    expect(geocodeUrlFrom('https://w.example.workers.dev/rt/')).toBe('https://w.example.workers.dev/geocode')
  })

  it('refuses an MTA host and a non-URL', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(geocodeUrlFrom('https://api.mta.info/rt')).toBeNull()
    expect(geocodeUrlFrom('not a url')).toBeNull()
    error.mockRestore()
  })
})
