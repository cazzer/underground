/**
 * A plain line layer's buffers (no bands) with the stretches under a route line left out (routeClip.ts): each
 * segment is cut where the clip says, positions and colors interpolated at the cuts, so a gradient along it (the
 * street edge fade) carries on across them. Pure.
 */
import type { LineBuffers } from './lineBuffers'
import { keptPieces, type RouteClip } from './routeClip'

export function clipLineBuffers(buffers: LineBuffers, clip: RouteClip): LineBuffers {
  const { positions: p, colors: c } = buffers
  const positions: number[] = []
  const colors: number[] = []
  const pieces: number[] = []
  const lerp = (from: Float32Array, i: number, t: number, out: number[]) => {
    for (let k = 0; k < 3; k++) out.push(from[i + k]! + (from[i + 3 + k]! - from[i + k]!) * t)
  }
  for (let i = 0; i + 6 <= p.length; i += 6) {
    const n = keptPieces(clip, p[i]!, p[i + 2]!, p[i + 3]!, p[i + 5]!, pieces)
    for (let j = 0; j < n; j++) {
      for (const t of [pieces[2 * j]!, pieces[2 * j + 1]!]) {
        lerp(p, i, t, positions)
        lerp(c, i, t, colors)
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}
