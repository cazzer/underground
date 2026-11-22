/**
 * Which tiles the view needs: the frustum's footprint on the ground (y = 0) and the tiles of one zoom that it
 * touches, inside the basemap's bbox, nearest the view center first.
 */
import { toLatLon } from '../projection'
import { bboxTileRange, latToTileY, lonToTileX, MIN_Z, tileKey, tileWidthM } from './tileMath'

/** A ray that misses the ground, or meets it farther than this many camera distances away, stops there. */
export const MAX_REACH = 4
/** Tiles within this many camera distances of the footprint are wanted too, so a small pan has them ready. */
export const MARGIN = 0.1
/** At most this many tiles at once; past it the zoom steps down. */
export const MAX_TILES = 24

/**
 * The four corner rays: camera position `p` (x, y, z) and `dirs`, four (x, y, z) directions in screen order
 * (bottom-left, bottom-right, top-right, top-left; any length).
 */
export interface FrustumRays {
  p: ArrayLike<number>
  dirs: ArrayLike<number>
  /** Camera to target, meters. */
  distance: number
}

/** Writes the footprint's four ground (x, z) corners to `out` (8 numbers). */
export function groundFootprint(rays: FrustumRays, out: Float64Array): void {
  const [px, py, pz] = [rays.p[0]!, rays.p[1]!, rays.p[2]!]
  const reach = MAX_REACH * rays.distance
  for (let i = 0; i < 4; i++) {
    const dx = rays.dirs[i * 3]!
    const dy = rays.dirs[i * 3 + 1]!
    const dz = rays.dirs[i * 3 + 2]!
    const len = Math.hypot(dx, dy, dz)
    let t = dy < 0 ? -py / dy : Infinity
    if (t * len > reach) t = reach / len
    out[i * 2] = px + dx * t
    out[i * 2 + 1] = pz + dz * t
  }
}

/**
 * Whether every corner of footprint `cur` lies within `margin` meters of the quad `sel` (both as groundFootprint
 * writes them; `sel` taken as convex). Allocation-free: the per-frame check for a view that slid out of its tiles.
 */
export function footprintInside(cur: Float64Array, sel: Float64Array, margin: number): boolean {
  let area = 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    area += sel[i * 2]! * sel[j * 2 + 1]! - sel[j * 2]! * sel[i * 2 + 1]!
  }
  const sign = area >= 0 ? 1 : -1
  for (let i = 0; i < 4; i++) {
    const ax = sel[i * 2]!
    const az = sel[i * 2 + 1]!
    const ex = sel[((i + 1) % 4) * 2]! - ax
    const ez = sel[((i + 1) % 4) * 2 + 1]! - az
    const len = Math.hypot(ex, ez)
    if (len === 0) continue
    for (let k = 0; k < 4; k++) {
      // Signed distance of the corner from this edge's line, positive on the quad's side.
      const inside = (sign * (ex * (cur[k * 2 + 1]! - az) - ez * (cur[k * 2]! - ax))) / len
      if (inside < -margin) return false
    }
  }
  return true
}

export interface WantedTile {
  key: number
  z: number
  x: number
  y: number
}

type Pt = [number, number]

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Convex hull, counter-clockwise (monotone chain); a clamped footprint need not be convex. */
function hull(points: Pt[]): Pt[] {
  const s = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower: Pt[] = []
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Separating-axis test of a convex polygon against the box [x0, x1] × [y0, y1] (the box's own axes are checked by the caller's range). */
function polygonMeetsBox(poly: Pt[], x0: number, y0: number, x1: number, y1: number): boolean {
  if (poly.length < 3) return true
  const corners: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const nx = b[1] - a[1]
    const ny = a[0] - b[0]
    // Counter-clockwise hull: the polygon lies on the side where n·(q - a) <= 0. Box entirely outside → separated.
    if (corners.every((c) => nx * (c[0] - a[0]) + ny * (c[1] - a[1]) > 0)) return false
  }
  return true
}

/** The tiles at zoom z touching the footprint (plus the margin) inside `bbox`, nearest `center` first. */
function tilesAt(footprint: Float64Array, center: { x: number; z: number }, distance: number, z: number, bbox: readonly [number, number, number, number]): WantedTile[] {
  const pts: Pt[] = []
  for (let i = 0; i < 4; i++) {
    const ll = toLatLon({ x: footprint[i * 2]!, z: footprint[i * 2 + 1]! })
    pts.push([lonToTileX(ll.lon, z), latToTileY(ll.lat, z)])
  }
  const poly = hull(pts)
  const m = (MARGIN * distance) / tileWidthM(z)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const box = bboxTileRange(bbox, z)
  const x0 = Math.max(box.x0, Math.floor(Math.min(...xs) - m))
  const x1 = Math.min(box.x1, Math.floor(Math.max(...xs) + m))
  const y0 = Math.max(box.y0, Math.floor(Math.min(...ys) - m))
  const y1 = Math.min(box.y1, Math.floor(Math.max(...ys) + m))
  const c = toLatLon(center)
  const cx = lonToTileX(c.lon, z)
  const cy = latToTileY(c.lat, z)
  const out: (WantedTile & { d: number })[] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (!polygonMeetsBox(poly, x - m, y - m, x + 1 + m, y + 1 + m)) continue
      out.push({ key: tileKey(z, x, y), z, x, y, d: (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 })
    }
  }
  out.sort((a, b) => a.d - b.d)
  return out.map(({ key, x, y }) => ({ key, z, x, y }))
}

/**
 * The tiles to load for a footprint, nearest `center` first, at zoom `z` (already clamped to the basemap's
 * maxzoom), stepping down a zoom while more than MAX_TILES would be needed; at MIN_Z the nearest MAX_TILES.
 */
export function selectTiles(
  footprint: Float64Array,
  center: { x: number; z: number },
  distance: number,
  z: number,
  bbox: readonly [number, number, number, number],
): { z: number; tiles: WantedTile[] } {
  for (let zz = z; ; zz--) {
    const tiles = tilesAt(footprint, center, distance, zz, bbox)
    if (tiles.length <= MAX_TILES) return { z: zz, tiles }
    if (zz <= MIN_Z) return { z: zz, tiles: tiles.slice(0, MAX_TILES) }
  }
}
