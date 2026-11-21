/** Shared encode/decode helpers for public/data. Pure. Type-only imports so Node can run this
 *  file directly (type stripping cannot resolve extensionless runtime imports). */
import type { LatLon } from '../lib/projection.ts'
import type { Direction, Shape, ShapeId, StopId } from './schema.ts'

export const E5 = 1e5

export interface ParsedTripId {
  origin: number
  route: string
  direction: Direction
  /** Path code after the direction, e.g. "03R"; empty when the id has none. */
  path: string
}

const TRIP_ID = /^(?:.*_)?(\d{6})_([A-Z0-9]+)\.\.?([NS])([A-Z0-9]*)$/
const SHAPE_ID = /^([A-Z0-9]+)\.\.?([NS])([A-Z0-9]*)$/

/** Accepts static "<prefix>_000600_1..S03R" and realtime "000600_1..S03R", "126600_SI.S03R", "126250_L..S". */
export function parseTripId(raw: string): ParsedTripId | null {
  const m = TRIP_ID.exec(raw)
  if (!m) return null
  return { origin: Number(m[1]), route: m[2]!, direction: m[3] as Direction, path: m[4]! }
}

export interface ParsedShapeId {
  /** Route token in the id; can differ from the route_id (W runs on "N"). */
  token: string
  direction: Direction
  path: string
}

/** Splits "1..S03R" or the single-dot "GS.N01R"; null if it is neither. */
export function parseShapeId(id: string): ParsedShapeId | null {
  const m = SHAPE_ID.exec(id)
  return m ? { token: m[1]!, direction: m[2] as Direction, path: m[3]! } : null
}

/** "GS.N01R" → "GS..N01R". GTFS static uses one dot for GS/FS; realtime uses one for GS, FS and SI. */
export function canonicalShapeId(raw: string): ShapeId {
  const p = parseShapeId(raw)
  if (!p) throw new Error(`Unparseable shape id: ${JSON.stringify(raw)}`)
  return `${p.token}..${p.direction}${p.path}`
}

export function shapeIdOf(p: ParsedTripId): ShapeId {
  return `${p.route}..${p.direction}${p.path}`
}

/** Realtime join key, e.g. "000600_1..S". Zero-padded so it matches the id's 6-digit prefix. */
export function tripKey(origin: number, route: string, direction: Direction): string {
  return `${String(origin).padStart(6, '0')}_${route}..${direction}`
}

export function segmentKey(from: StopId, to: StopId): string {
  return `${from}>${to}`
}

/** First value absolute, then differences. */
export function deltaEncode(values: readonly number[]): number[] {
  return values.map((v, i) => (i === 0 ? v : v - values[i - 1]!))
}

export function deltaDecode(values: readonly number[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const v of values) {
    acc += v
    out.push(acc)
  }
  return out
}

export function decodeShapePoints(shape: Pick<Shape, 'lat' | 'lon'>): LatLon[] {
  const lat = deltaDecode(shape.lat)
  const lon = deltaDecode(shape.lon)
  return lat.map((la, i) => ({ lat: la / E5, lon: lon[i]! / E5 }))
}
