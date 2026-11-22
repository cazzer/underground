/**
 * Web Mercator (XYZ, the scheme the basemap tiles use) against the scene's projection. Tile coordinates are
 * fractional here: tile (x, y) at zoom z spans [x, x + 1) × [y, y + 1). Keys are numbers, so a Set or Map of them
 * never allocates strings.
 */
import { groundX } from '../projection'

/** A basemap tile's nominal size in pixels (Protomaps tiles are drawn at 512 px). */
export const TILE_PX = 512
/** The coarsest zoom ever requested: zoomed out further, z 9 tiles stand in. */
export const MIN_Z = 9

const DEG = Math.PI / 180

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}

export function latToTileY(lat: number, z: number): number {
  const phi = lat * DEG
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** z
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

export function tileYToLat(y: number, z: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / DEG
}

const Z_MUL = 2 ** 30
const X_MUL = 2 ** 15

/** One number per tile; x and y stay under 2^15 up to z 15. */
export function tileKey(z: number, x: number, y: number): number {
  return z * Z_MUL + x * X_MUL + y
}

export function keyZ(key: number): number {
  return Math.floor(key / Z_MUL)
}

export function keyX(key: number): number {
  return Math.floor((key % Z_MUL) / X_MUL)
}

export function keyY(key: number): number {
  return key % X_MUL
}

/** The tile one zoom out that contains this one; z 0 has none (returns itself). */
export function parentKey(key: number): number {
  const z = keyZ(key)
  if (z === 0) return key
  return tileKey(z - 1, Math.floor(keyX(key) / 2), Math.floor(keyY(key) / 2))
}

/** Whether `key` lies inside `ancestor`, strictly deeper. */
export function isDescendant(key: number, ancestor: number): boolean {
  const dz = keyZ(key) - keyZ(ancestor)
  if (dz <= 0) return false
  const s = 2 ** dz
  return Math.floor(keyX(key) / s) === keyX(ancestor) && Math.floor(keyY(key) / s) === keyY(ancestor)
}

export interface TileRange {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Inclusive tile range covering a [west, south, east, north] box at zoom z. */
export function bboxTileRange(bbox: readonly [number, number, number, number], z: number): TileRange {
  const [west, south, east, north] = bbox
  const last = 2 ** z - 1
  const clamp = (v: number) => Math.min(last, Math.max(0, Math.floor(v)))
  return { x0: clamp(lonToTileX(west, z)), y0: clamp(latToTileY(north, z)), x1: clamp(lonToTileX(east, z)), y1: clamp(latToTileY(south, z)) }
}

/** A tile's east-west width in scene meters (the scene is equirectangular, so this holds at every latitude). */
export function tileWidthM(z: number): number {
  return groundX(tileXToLon(1, z)) - groundX(tileXToLon(0, z))
}

/** Scene meters per tile pixel at zoom z. */
export function metersPerPixel(z: number): number {
  return tileWidthM(z) / TILE_PX
}

/** The zoom whose tile pixels best match `metersPerScreenPx`, clamped to [MIN_Z, maxzoom]. */
export function zoomFor(metersPerScreenPx: number, maxzoom: number): number {
  const z = Math.round(Math.log2(tileWidthM(0) / TILE_PX / metersPerScreenPx))
  return Math.min(maxzoom, Math.max(MIN_Z, Number.isFinite(z) ? z : maxzoom))
}
