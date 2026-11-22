/**
 * One MVT tile to line segments per class, in absolute scene meters at street level: (x, 0, z) pairs, six floats
 * a segment. Lines and polygon outlines are clipped to the tile square; a polygon edge the tiler cut along the
 * tile edge is dropped. Runs in the basemap worker.
 */
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { groundX, groundZ } from '../projection'
import { clipSegment, onTileEdge } from './clip'
import { classOf, type BasemapClass, type GeomType } from './featureClass'
import { tileXToLon, tileYToLat } from './tileMath'

export type ClassBuffers = Partial<Record<BasemapClass, Float32Array>>

/**
 * Raw MVT, as far as one byte can tell: an empty tile, or a Tile message starting with field 3 (layers). An HTML
 * page (`<`) or gzip (1f 8b; the worker inflates that first, inflate.ts) is not.
 */
export function isMvtBytes(bytes: Uint8Array): boolean {
  return bytes.length === 0 || bytes[0] === 0x1a
}

export function decodeTile(bytes: Uint8Array, z: number, x: number, y: number, layers: readonly string[]): ClassBuffers {
  const tile = new VectorTile(new PbfReader(bytes))
  const acc: Partial<Record<BasemapClass, number[]>> = {}
  const seg = new Float64Array(4)
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
      for (const line of f.loadGeometry()) {
        for (let j = 1; j < line.length; j++) {
          const a = line[j - 1]!
          const b = line[j]!
          if (!clipSegment(a.x, a.y, b.x, b.y, 0, extent, seg)) continue
          if (ring && onTileEdge(seg[0]!, seg[1]!, seg[2]!, seg[3]!, 0, extent)) continue
          if (seg[0] === seg[2] && seg[1] === seg[3]) continue
          out.push(sx(seg[0]!), 0, sz(seg[1]!), sx(seg[2]!), 0, sz(seg[3]!))
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
