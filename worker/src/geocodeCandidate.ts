import { insideNyc } from './geocodeQuery'
import { nameKey } from './geocodeText'
import type { GeocodeKind, GeocodeResult, GeocodeSource } from './schema'

/** One upstream row after the trim: the result, plus what the merge compares. */
export interface Candidate {
  result: GeocodeResult
  /** The label's name part, before the area. */
  name: string
  /** `nameKey(name)`. */
  key: string
  /** `nameKey` of a street address the row carries beside its name (Photon), else null. Two branches of a chain differ by it. */
  address: string | null
}

export interface SourceResults {
  candidates: Candidate[]
  /** Rows skipped as malformed or not wanted (a count, for the miss log). */
  dropped: number
  /** Rows with a good point outside the NYC bbox. */
  outside: number
}

/** What a source's own reader makes of one feature's properties; null drops the row. */
export interface Row {
  name: string
  label: string
  kind: GeocodeKind
  address?: string | null
}

export type RowReader = (properties: Record<string, unknown>) => Row | null

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5

/** A GeoJSON Point's [lon, lat], or null. */
function pointOf(geometry: unknown): [number, number] | null {
  if (!isRecord(geometry) || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const [lon, lat] = geometry.coordinates as unknown[]
  return typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat)
    ? [lon, lat]
    : null
}

/**
 * The shared half of both trims. Throws a `TypeError` with a fixed message (no content) when `json` is not
 * a GeoJSON-like object with a `features` array, so the caller counts the source as failed.
 */
export function trimFeatures(json: unknown, source: GeocodeSource, read: RowReader): SourceResults {
  if (!isRecord(json) || !Array.isArray(json.features)) throw new TypeError('not a feature collection')
  const out: SourceResults = { candidates: [], dropped: 0, outside: 0 }
  for (const feature of json.features as unknown[]) {
    const point = isRecord(feature) ? pointOf(feature.geometry) : null
    const row = point && isRecord(feature) && isRecord(feature.properties) ? read(feature.properties) : null
    if (!point || !row) {
      out.dropped++
      continue
    }
    const [lon, lat] = point
    if (!insideNyc(lat, lon)) {
      out.outside++
      continue
    }
    const result: GeocodeResult = { label: row.label, kind: row.kind, lat: round5(lat), lon: round5(lon), source }
    out.candidates.push({
      result,
      name: row.name,
      key: nameKey(row.name),
      address: row.address ? nameKey(row.address) : null,
    })
  }
  return out
}

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
