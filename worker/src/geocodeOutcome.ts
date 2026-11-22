import type { SourceResults } from './geocodeCandidate'
import { mergeCandidates } from './geocodeMerge'
import type { GeocodeQuery } from './geocodeQuery'
import { queryTokens } from './geocodeText'
import {
  GEOCODE_ATTRIBUTION,
  GEOCODE_SCHEMA_VERSION,
  type GeocodeResponse,
  type GeocodeSource,
} from './schema'

/** The whole vocabulary of upstream failures. Never a message: a fetch error's text can hold the URL, and so the query. */
export type GeocodeFetchError = 'timeout' | 'fetch-failed' | 'too-large' | 'parse-failed' | 'bad-shape' | `http-${number}`

/**
 * Whether a failure says the source is struggling (back it off) rather than that this query upset it
 * (a 4xx other than 429, a body that would not parse or fit: another query may be fine).
 */
export function shouldBackOff(error: GeocodeFetchError): boolean {
  if (error === 'timeout' || error === 'fetch-failed') return true
  if (!error.startsWith('http-')) return false
  const status = Number(error.slice(5))
  return status === 429 || status >= 500
}

export type SourceOutcome =
  | { status: 'ok'; results: SourceResults; cacheStatus: string | null }
  | { status: 'failed'; error: GeocodeFetchError }
  | { status: 'limited' | 'backoff' | 'unneeded' }

export type GeocodeAnswer =
  | { status: 200; body: string; cacheable: boolean; results: number }
  | { status: 502; body: string }
  | { status: 503; body: string }

const SOURCES: readonly GeocodeSource[] = ['geosearch', 'photon']

/**
 * The answer for what the sources gave. A source this answer wanted but could not give (failed, limited,
 * in backoff) makes it incomplete and uncacheable; with no source ok, a failure is a 502 and otherwise
 * (nothing could be called) a 503.
 */
export function geocodeAnswer(
  query: GeocodeQuery,
  outcomes: Record<GeocodeSource, SourceOutcome>,
  photonFirst: boolean,
): GeocodeAnswer {
  const all = SOURCES.map((s) => outcomes[s])
  if (!all.some((o) => o.status === 'ok')) {
    return all.some((o) => o.status === 'failed')
      ? { status: 502, body: '{"error":"upstream"}' }
      : { status: 503, body: '{"error":"busy"}' }
  }
  const order: GeocodeSource[] = photonFirst ? ['photon', 'geosearch'] : ['geosearch', 'photon']
  const lists = order.flatMap((s) => {
    const o = outcomes[s]
    return o.status === 'ok' ? [o.results.candidates] : []
  })
  const results = mergeCandidates(lists, queryTokens(query.text))
  const attribution: GeocodeResponse['attribution'] = {}
  for (const s of SOURCES) if (results.some((r) => r.source === s)) attribution[s] = GEOCODE_ATTRIBUTION[s]
  const incomplete = all.some((o) => o.status === 'failed' || o.status === 'limited' || o.status === 'backoff')
  const body: GeocodeResponse = { version: GEOCODE_SCHEMA_VERSION, results, attribution, incomplete }
  return { status: 200, body: JSON.stringify(body), cacheable: !incomplete, results: results.length }
}

function statusOf(o: SourceOutcome): string {
  return o.status === 'failed' ? `failed:${o.error}` : o.status
}

const countOf = (o: SourceOutcome, field: 'dropped' | 'outside'): number => (o.status === 'ok' ? o.results[field] : 0)

/** The miss log line: counts and fixed codes only. Never the query, the focus or a label. */
export function logLine(
  colo: string | undefined,
  outcomes: Record<GeocodeSource, SourceOutcome>,
  results: number,
): string {
  const by = <T>(f: (o: SourceOutcome) => T): Record<GeocodeSource, T> => ({
    geosearch: f(outcomes.geosearch),
    photon: f(outcomes.photon),
  })
  return JSON.stringify({
    event: 'geocode-miss',
    colo,
    geosearch: statusOf(outcomes.geosearch),
    photon: statusOf(outcomes.photon),
    results,
    dropped: by((o) => countOf(o, 'dropped')),
    outside: by((o) => countOf(o, 'outside')),
    upstreamCache: by((o) => (o.status === 'ok' ? o.cacheStatus : null)),
  })
}
