import { focusParam } from '../lib/geocodeFocus'
import type { GeocodeAnswer } from '../lib/geocodeSearch'
import type { LatLon } from '../lib/projection'
import {
  GEOCODE_KINDS,
  GEOCODE_MAX_RESULTS,
  GEOCODE_SCHEMA_VERSION,
  GEOCODE_SOURCES,
  NYC_BBOX,
  type GeocodeKind,
  type GeocodeResponse,
  type GeocodeResult,
  type GeocodeSource,
} from './realtime'
import { SchemaMismatchError } from './realtimeFetch'

/** The Worker's sequential worst case (both sources, each with its own timeout) is about 6 s. */
export const GEOCODE_TIMEOUT_MS = 8000
const LABEL_MAX = 200

/** The request: the query and, when there is one, the rounded focus. The user's location is never an input here. */
export function geocodeRequestUrl(base: string, query: string, focus: LatLon | null): string {
  const url = new URL(base)
  url.searchParams.set('q', query)
  if (focus) url.searchParams.set('focus', focusParam(focus))
  return url.href
}

/** A body that isn't the contract's shape (its message names a field, never a label). */
class GeocodeParseError extends Error {}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Messages name the row and field, never a label: they may reach a log.
function parseResult(raw: unknown, index: number): GeocodeResult {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const { label, kind, source, lat, lon } = r
  if (typeof label !== 'string' || label === '' || label.length > LABEL_MAX) throw new GeocodeParseError(`place ${index} has a bad label`)
  if (!GEOCODE_KINDS.includes(kind as GeocodeKind)) throw new GeocodeParseError(`place ${index} has a bad kind`)
  if (!GEOCODE_SOURCES.includes(source as GeocodeSource)) throw new GeocodeParseError(`place ${index} has a bad source`)
  const [minLon, minLat, maxLon, maxLat] = NYC_BBOX
  if (!isNumber(lat) || lat < minLat || lat > maxLat) throw new GeocodeParseError(`place ${index} has a bad lat`)
  if (!isNumber(lon) || lon < minLon || lon > maxLon) throw new GeocodeParseError(`place ${index} has a bad lon`)
  return { label, kind: kind as GeocodeKind, source: source as GeocodeSource, lat, lon }
}

/** A v1 body (before the street index) is a valid v2 one without osm rows, so a new client still reads a Worker not yet deployed. */
const ACCEPTED_VERSIONS: readonly unknown[] = [1, GEOCODE_SCHEMA_VERSION]

/** Checks a /geocode body at the boundary: version, the rows (each field), the attribution and `incomplete`. */
export function parseGeocodeResponse(raw: unknown): GeocodeResponse {
  if (typeof raw !== 'object' || raw === null) throw new GeocodeParseError('address response is not an object')
  const r = raw as Record<string, unknown>
  if (!ACCEPTED_VERSIONS.includes(r.version)) {
    throw new SchemaMismatchError(`address schema v${String(r.version)}, client expects v${GEOCODE_SCHEMA_VERSION}; reload`)
  }
  if (!Array.isArray(r.results) || r.results.length > GEOCODE_MAX_RESULTS) throw new GeocodeParseError('address response has bad results')
  const results = r.results.map(parseResult)
  const attribution = r.attribution
  if (typeof attribution !== 'object' || attribution === null || Object.values(attribution).some((v) => typeof v !== 'string')) {
    throw new GeocodeParseError('address response has bad attribution')
  }
  if (typeof r.incomplete !== 'boolean') throw new GeocodeParseError('address response has no incomplete flag')
  return { version: GEOCODE_SCHEMA_VERSION, results, attribution: attribution as GeocodeResponse['attribution'], incomplete: r.incomplete }
}

/** HTTP status to a failure: 503 is the Worker's `busy` and 429 its `rate-limited` (both read "not available right now", and nothing retries); 400 and 403 are our request refused. */
function failureForStatus(status: number): Extract<GeocodeAnswer, { ok: false }> {
  if (status === 503 || status === 429) return { ok: false, error: 'busy', status }
  if (status === 400 || status === 403) return { ok: false, error: 'rejected', status }
  return { ok: false, error: 'upstream', status }
}

/**
 * One lookup. Failures come back as `ok: false` (never thrown); the only throw is the caller's own abort. An
 * answer carries a failure kind and a status, never an error's message: a fetch error can name the URL, and the URL
 * holds the query.
 */
export async function fetchGeocode(url: string, signal: AbortSignal): Promise<GeocodeAnswer> {
  try {
    // no-store: the query stays out of the browser's disk cache; credentials omitted: nothing identifies the user.
    const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(GEOCODE_TIMEOUT_MS)]), cache: 'no-store', credentials: 'omit' })
    if (!res.ok) return failureForStatus(res.status)
    return { ok: true, response: parseGeocodeResponse(await res.json()) }
  } catch (err) {
    if (signal.aborted) throw err
    if (err instanceof DOMException && err.name === 'TimeoutError') return { ok: false, error: 'timeout', status: null }
    if (err instanceof SchemaMismatchError) return { ok: false, error: 'schema', status: null }
    // A body that isn't JSON or isn't the shape; anything else thrown is the network (a TypeError).
    if (err instanceof SyntaxError || err instanceof GeocodeParseError) return { ok: false, error: 'bad-response', status: null }
    return { ok: false, error: 'network', status: null }
  }
}
