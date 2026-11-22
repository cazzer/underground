/**
 * One MVT tile to line segments per class, in absolute scene meters at street level: (x, 0, z) pairs, six floats
 * a segment. Lines and polygon outlines are clipped to the tile square; a polygon edge the tiler cut along the
 * tile edge is dropped, and so is a ring too small for the tile's zoom (areaFilter.ts). Roads are also cut where
 * they run under a drawn route line (routeClip.ts). Runs in the basemap worker.
 */
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { groundX, groundZ } from '../projection'
import { keptPieces, type RouteClip } from '../routeClip'
import { AREA_STEPS, keepRing, ringArea } from './areaFilter'
import { clipSegment, onTileEdge } from './clip'
import { classOf, isRoadClass, type BasemapClass, type GeomType } from './featureClass'
import { tileXToLon, tileYToLat } from './tileMath'

export type ClassBuffers = Partial<Record<BasemapClass, Float32Array>>

/**
 * Raw MVT, as far as one byte can tell: an empty tile, or a Tile message starting with field 3 (layers). An HTML
 * page (`<`) or gzip (1f 8b; the worker inflates that first, inflate.ts) is not.
 */
export function isMvtBytes(bytes: Uint8Array): boolean {
  return bytes.length === 0 || bytes[0] === 0x1a
}

/** From this zoom in every ring is drawn, whatever its size. */
const FILTER_BELOW_Z = Math.max(...AREA_STEPS.map((s) => s.fromZ))

/** Whether a polygon ring (tile-local points) is drawn at tile zoom `z` (areaFilter.ts): its area in scene meters. */
function keepRingOf(
  line: readonly { x: number; y: number }[],
  extent: number,
  z: number,
  sx: (u: number) => number,
  sz: (v: number) => number,
): boolean {
  if (z >= FILTER_BELOW_Z) return true
  if (line.some((p) => p.x <= 0 || p.y <= 0 || p.x >= extent || p.y >= extent)) return true
  const xz: number[] = []
  for (const p of line) xz.push(sx(p.x), sz(p.y))
  return keepRing(ringArea(xz), z, false)
}

/**
 * Tiles at this zoom or coarser are not cut: they are drawn from about 14 km out on a phone (10 m a pixel), where a
 * bundle is a pixel or two wide, and their roads are generalized by more than the clip's distance.
 */
export const CLIP_MAX_UNCUT_Z = 12

/** `clip` (scene meters) cuts the roads under the route lines in tiles finer than CLIP_MAX_UNCUT_Z; null draws them whole. */
export function decodeTile(
  bytes: Uint8Array,
  z: number,
  x: number,
  y: number,
  layers: readonly string[],
  clip: RouteClip | null,
): ClassBuffers {
  const tile = new VectorTile(new PbfReader(bytes))
  const acc: Partial<Record<BasemapClass, number[]>> = {}
  const seg = new Float64Array(4)
  const pieces: number[] = []
  for (const name of layers) {
    const layer = tile.layers[name]
    if (!layer) continue
    const extent = layer.extent
    /** Tile-local units to scene meters; mercator y needs the full inverse, so both go through lon/lat. */
    const sx = (u: number) => groundX(tileXToLon(x + u / extent, z))
    const sz = (v: number) => groundZ(tileYToLat(y + v / extent, z))
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      const cls = classOf(name, f.type as GeomType, f.properties)
      if (cls === null) continue
      const out = (acc[cls] ??= [])
      const ring = f.type === 3
      const cut = clip !== null && z > CLIP_MAX_UNCUT_Z && isRoadClass(cls) ? clip : null
      for (const line of f.loadGeometry()) {
        if (ring && !keepRingOf(line, extent, z, sx, sz)) continue
        for (let j = 1; j < line.length; j++) {
          const a = line[j - 1]!
          const b = line[j]!
          if (!clipSegment(a.x, a.y, b.x, b.y, 0, extent, seg)) continue
          if (ring && onTileEdge(seg[0]!, seg[1]!, seg[2]!, seg[3]!, 0, extent)) continue
          if (seg[0] === seg[2] && seg[1] === seg[3]) continue
          const ax = sx(seg[0]!)
          const az = sz(seg[1]!)
          const bx = sx(seg[2]!)
          const bz = sz(seg[3]!)
          if (cut === null) {
            out.push(ax, 0, az, bx, 0, bz)
            continue
          }
          const n = keptPieces(cut, ax, az, bx, bz, pieces)
          for (let k = 0; k < n; k++) {
            const t0 = pieces[2 * k]!
            const t1 = pieces[2 * k + 1]!
            out.push(ax + (bx - ax) * t0, 0, az + (bz - az) * t0, ax + (bx - ax) * t1, 0, az + (bz - az) * t1)
          }
        }
      }
    }
  }
  const buffers: ClassBuffers = {}
  for (const [cls, list] of Object.entries(acc) as [BasemapClass, number[]][]) {
    if (list.length > 0) buffers[cls] = new Float32Array(list)
  }
  return buffers
}
