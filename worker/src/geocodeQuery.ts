import { GEOCODE_SCHEMA_VERSION } from './schema'
import { INVISIBLE, nameKey } from './geocodeText'

/** [minLon, minLat, maxLon, maxLat]; equals `spec.bbox` in data/basemap/basemap.json (a test checks). */
export const NYC_BBOX: readonly [number, number, number, number] = [-74.2591, 40.4774, -73.7004, 40.9176]

const RAW_MAX_UNITS = 400
const TEXT_MIN = 3
const TEXT_MAX = 100
const FOCUS_PATTERN = /^-?\d{1,3}(\.\d{1,8})?,-?\d{1,3}(\.\d{1,8})?$/

export function insideNyc(lat: number, lon: number): boolean {
  return lon >= NYC_BBOX[0] && lat >= NYC_BBOX[1] && lon <= NYC_BBOX[2] && lat <= NYC_BBOX[3]
}

/** NFKC, curly apostrophes straight, invisible characters out, whitespace collapsed, lowercase. */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    // Invisible characters are removed before the collapse, so "a \u200B b" collapses to "a b".
    .trim()
    .toLowerCase()
}

export interface GeocodeQuery {
  text: string
  /** The map centre or a chosen station, rounded to 2 decimals; never the user's location. */
  focus: { lat: number; lon: number } | null
}

export type ParsedRequest = { ok: true; query: GeocodeQuery } | { ok: false; error: 'bad-query' | 'bad-focus' }

const round2 = (n: number): number => Math.round(n * 100) / 100

export function parseGeocodeRequest(url: URL): ParsedRequest {
  const raw = url.searchParams.get('q')
  if (raw === null || raw.length > RAW_MAX_UNITS) return { ok: false, error: 'bad-query' }
  const text = normalizeQuery(raw)
  const length = Array.from(text).length
  if (length < TEXT_MIN || length > TEXT_MAX) return { ok: false, error: 'bad-query' }

  const rawFocus = url.searchParams.get('focus')
  if (rawFocus === null) return { ok: true, query: { text, focus: null } }
  if (!FOCUS_PATTERN.test(rawFocus)) return { ok: false, error: 'bad-focus' }
  const [lat, lon] = rawFocus.split(',').map(Number) as [number, number]
  // Outside the city it is dropped, not an error: the map can be anywhere.
  if (!insideNyc(lat, lon)) return { ok: true, query: { text, focus: null } }
  return { ok: true, query: { text, focus: { lat: round2(lat), lon: round2(lon) } } }
}

/** The LRU key, and against the request URL's origin the Cache API key. */
export function cacheKeyPath(query: GeocodeQuery): string {
  const f = query.focus ? `${query.focus.lat.toFixed(2)},${query.focus.lon.toFixed(2)}` : ''
  return `/geocode?v=${GEOCODE_SCHEMA_VERSION}&q=${encodeURIComponent(query.text)}&f=${f}`
}

/** "120 broadway", "37-12 82 st": a house number then a street. */
export function isAddressLike(text: string): boolean {
  return /^\d+[a-z]?(?:-\d+)?\s+\S/.test(text)
}

const BUSINESS_WORDS = new Set(
  (
    'deli pizza pizzeria cafe coffee bakery bagel bagels bar pub restaurant diner grill bistro kitchen burger ramen ' +
    'sushi taqueria hotel inn store shop market pharmacy bank gym fitness salon theater theatre cinema museum ' +
    'gallery club school hospital clinic church library'
  ).split(' '),
)

/** A query that names a business, which only Photon (OSM) knows: ask both sources at once. */
export function looksLikeBusiness(text: string): boolean {
  return text.includes("'") || nameKey(text).split(' ').some((word) => BUSINESS_WORDS.has(word))
}
