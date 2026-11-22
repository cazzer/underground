/**
 * Where a route's variant shapes draw exactly under its primary. A variant segment with the same two ends, heights
 * and band inputs as one of its primary's segments gets the same pixels at every zoom, tilt, depth and band state
 * (the band shader reads nothing else), and the primary draws after every variant (buildLineBuffers' order), so
 * the merged route lines can leave it out. Only the drawn lines skip it: trains, picks and the realtime join keep
 * every shape's full track. About half of the variant segments are like this (shared GTFS points under the
 * primary's). The rest stay drawn: their unique stretches (express tracks, branches, short turns), shared stretches
 * resampled at other distances than the primary's, and those under the primary's platform fade. Pure.
 */
import type { ShapeId, StationId } from '../data/schema'
import { BAND_INPUTS } from './lineBuffers'
import type { ShapePath } from './network'
import type { PlatformSpan } from './platformSpan'

/** Segment ends this close (meters) are one point: 0.03 px at the closest zoom (40 m). */
export const COVER_POINT_M = 1e-3
/** Heights this close (scene meters, before the depth factor) are one height. */
export const COVER_Y_M = 1e-3
/**
 * Band inputs (miter vector, slot, half-width) this close are one input. The drawn shift is at most about 20 px
 * (bandOffset.ts: a few slots of pitch plus the merged track offset), so this moves a drawn end under 0.01 px.
 */
export const COVER_BAND = 1e-4

export interface PrimaryCover {
  /** The route and direction's primary shape, which draws these segments. */
  primaryId: ShapeId
  /** 1 where segment i (points i, i + 1) draws exactly under one of the primary's segments. */
  segments: Uint8Array
}

/** Vertex indices of a path by 1 m cell. */
type VertexCells = Map<number, number[]>

const cellKey = (cx: number, cz: number): number => (cx + 2 ** 21) * 2 ** 22 + (cz + 2 ** 21)

function vertexCells(path: ShapePath): VertexCells {
  const cells: VertexCells = new Map()
  path.points.forEach((p, i) => {
    const key = cellKey(Math.floor(p.x), Math.floor(p.z))
    const list = cells.get(key)
    if (list) list.push(i)
    else cells.set(key, [i])
  })
  return cells
}

const samePoint = (a: ShapePath, i: number, b: ShapePath, k: number): boolean =>
  Math.hypot(a.points[i]!.x - b.points[k]!.x, a.points[i]!.z - b.points[k]!.z) <= COVER_POINT_M

/** Primary vertices at variant vertex i. */
function matches(variant: ShapePath, i: number, primary: ShapePath, cells: VertexCells): number[] {
  const { x, z } = variant.points[i]!
  const out: number[] = []
  for (let cx = Math.floor(x - COVER_POINT_M); cx <= Math.floor(x + COVER_POINT_M); cx++) {
    for (let cz = Math.floor(z - COVER_POINT_M); cz <= Math.floor(z + COVER_POINT_M); cz++) {
      for (const k of cells.get(cellKey(cx, cz)) ?? []) if (samePoint(variant, i, primary, k)) out.push(k)
    }
  }
  return out
}

/** Same height and band inputs at variant vertex i and primary vertex k. */
function sameInputs(variant: ShapePath, i: number, primary: ShapePath, k: number): boolean {
  if (Math.abs(variant.y[i]! - primary.y[k]!) > COVER_Y_M) return false
  for (let c = 0; c < BAND_INPUTS; c++) {
    if (Math.abs(variant.bandInputs[i * BAND_INPUTS + c]! - primary.bandInputs[k * BAND_INPUTS + c]!) > COVER_BAND) return false
  }
  return true
}

/** Whether segment i (points i, i + 1) of `path` runs inside any of `spans` (where the platform fade can be above 0). */
function inSpan(path: ShapePath, i: number, spans: readonly PlatformSpan[]): boolean {
  const d0 = path.cumulative[i]!
  const d1 = path.cumulative[i + 1]!
  return spans.some((s) => d1 > s.d0 && d0 < s.d1)
}

/**
 * The segments of `variant` that draw under `primary`'s; null when none do. One under a platform span of the
 * primary (`primarySpans`, every station's) stays drawn: the fade turns the primary translucent there, so the
 * variant under it shows. The variant's own spans don't matter: under an opaque primary its fade never shows.
 */
export function primaryCover(
  variant: ShapePath,
  primary: ShapePath,
  primarySpans: readonly PlatformSpan[],
  cells: VertexCells = vertexCells(primary),
): PrimaryCover | null {
  const n = variant.points.length
  const segments = new Uint8Array(Math.max(n - 1, 0))
  let any = false
  // Primary vertices at the current variant vertex; in a shared run only the one after the last match is tried.
  let at = n > 0 ? matches(variant, 0, primary, cells) : []
  for (let i = 0; i + 1 < n; i++) {
    const next = at.filter((k) => k + 1 < primary.points.length && samePoint(variant, i + 1, primary, k + 1))
    const k = next.find((k) => sameInputs(variant, i, primary, k) && sameInputs(variant, i + 1, primary, k + 1))
    if (k !== undefined && !inSpan(primary, k, primarySpans)) {
      segments[i] = 1
      any = true
    }
    at = next.length > 0 ? next.map((k) => k + 1) : matches(variant, i + 1, primary, cells)
  }
  return any ? { primaryId: primary.id, segments } : null
}

/** Each shape's spans over every station. */
function spansByShape(spans: ReadonlyMap<StationId, ReadonlyMap<ShapeId, PlatformSpan>>): Map<ShapeId, PlatformSpan[]> {
  const out = new Map<ShapeId, PlatformSpan[]>()
  for (const byShape of spans.values()) {
    for (const [id, span] of byShape) {
      const list = out.get(id)
      if (list) list.push(span)
      else out.set(id, [span])
    }
  }
  return out
}

/** `shapes` with each variant's `cover` against its route and direction's primary (same order; others unchanged). */
export function coverVariants(
  shapes: readonly ShapePath[],
  spans: ReadonlyMap<StationId, ReadonlyMap<ShapeId, PlatformSpan>>,
): ShapePath[] {
  const primaries = new Map<string, { path: ShapePath; cells: VertexCells }>()
  for (const s of shapes) if (s.primary) primaries.set(`${s.routeId}\u0000${s.direction}`, { path: s, cells: vertexCells(s) })
  const byShape = spansByShape(spans)
  return shapes.map((s) => {
    const primary = s.primary ? undefined : primaries.get(`${s.routeId}\u0000${s.direction}`)
    if (!primary) return s
    const cover = primaryCover(s, primary.path, byShape.get(primary.path.id) ?? [], primary.cells)
    return cover ? { ...s, cover } : s
  })
}
