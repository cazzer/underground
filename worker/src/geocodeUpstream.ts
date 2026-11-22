import { GEOCODE_TTL_MS } from './cache'
import type { SourceResults } from './geocodeCandidate'
import type { GeocodeFetchError, SourceOutcome } from './geocodeOutcome'
import { NYC_BBOX, type GeocodeQuery } from './geocodeQuery'
import { trimGeoSearch } from './geosearch'
import { trimPhoton } from './photon'
import { readBody } from './upstream'

export const GEOCODE_USER_AGENT = 'underground-nyc-subway-map (+https://github.com/cazzer/underground)'
const TIMEOUT_MS = 3000
const MAX_BYTES = 256 * 1024
const GEOSEARCH_SIZE = 10
const PHOTON_LIMIT = 12

const [MIN_LON, MIN_LAT, MAX_LON, MAX_LAT] = NYC_BBOX

export function geoSearchUrl(q: GeocodeQuery): string {
  const p = new URLSearchParams({ text: q.text, size: String(GEOSEARCH_SIZE) })
  p.set('boundary.rect.min_lon', String(MIN_LON))
  p.set('boundary.rect.max_lon', String(MAX_LON))
  p.set('boundary.rect.min_lat', String(MIN_LAT))
  p.set('boundary.rect.max_lat', String(MAX_LAT))
  if (q.focus) {
    p.set('focus.point.lat', q.focus.lat.toFixed(2))
    p.set('focus.point.lon', q.focus.lon.toFixed(2))
  }
  return `https://geosearch.planninglabs.nyc/v2/autocomplete?${p}`
}

export function photonUrl(q: GeocodeQuery): string {
  const p = new URLSearchParams({ q: q.text, limit: String(PHOTON_LIMIT), lang: 'en', bbox: NYC_BBOX.join(',') })
  if (q.focus) {
    p.set('lat', q.focus.lat.toFixed(2))
    p.set('lon', q.focus.lon.toFixed(2))
  }
  return `https://photon.komoot.io/api?${p}`
}

type JsonFetch =
  | { ok: true; json: unknown; cacheStatus: string | null }
  | { ok: false; error: GeocodeFetchError; cacheStatus: string | null }

/**
 * One upstream GET as parsed JSON. Never rejects, and never reports a thrown error's text (a fetch error can
 * carry the URL, and so the query): only a fixed code. The client's headers are not forwarded.
 */
export async function fetchCappedJson(url: string, cacheTtlS: number): Promise<JsonFetch> {
  let cacheStatus: string | null = null
  let bytes: Uint8Array | string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': GEOCODE_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cf: { cacheTtlByStatus: { '200-299': cacheTtlS, '400-599': 0 }, cacheEverything: true },
    })
    cacheStatus = res.headers.get('cf-cache-status')
    if (!res.ok) {
      await res.body?.cancel()
      return { ok: false, error: `http-${res.status}`, cacheStatus }
    }
    bytes = await readBody(res, MAX_BYTES)
  } catch (e) {
    const timedOut = (e as { name?: unknown } | null)?.name === 'TimeoutError'
    return { ok: false, error: timedOut ? 'timeout' : 'fetch-failed', cacheStatus }
  }
  if (typeof bytes === 'string') {
    return { ok: false, error: bytes.startsWith('body too large') ? 'too-large' : 'parse-failed', cacheStatus }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    return { ok: true, json: JSON.parse(text), cacheStatus }
  } catch {
    return { ok: false, error: 'parse-failed', cacheStatus }
  }
}

async function fetchSource(url: string, trim: (json: unknown) => SourceResults): Promise<SourceOutcome> {
  const got = await fetchCappedJson(url, GEOCODE_TTL_MS / 1000)
  if (!got.ok) return { status: 'failed', error: got.error }
  try {
    return { status: 'ok', results: trim(got.json), cacheStatus: got.cacheStatus }
  } catch {
    // The trim's TypeError has a fixed message; the code is all that is kept.
    return { status: 'failed', error: 'bad-shape' }
  }
}

export const fetchGeoSearch = (q: GeocodeQuery): Promise<SourceOutcome> => fetchSource(geoSearchUrl(q), trimGeoSearch)
export const fetchPhoton = (q: GeocodeQuery): Promise<SourceOutcome> => fetchSource(photonUrl(q), trimPhoton)
