import { Color } from 'three'
import type { LineBuffers } from '../lib/lineBuffers'

const EDGE_SEGMENTS = 96
const RING_SEGMENTS = 32
/** Reticle proportions as multiples of the ring radius (1). */
export const TICK_OUTER = 1.7
/** The halo is a band just around the ring, not a disc: the station under the reticle stays visible. */
export const HALO_INNER = 0.8
export const HALO_OUTER = 1.25
export const DOT_RADIUS = 0.3

function push(out: number[], ax: number, az: number, bx: number, bz: number): void {
  out.push(ax, 0, az, bx, 0, bz)
}

function circle(out: number[], segments: number, radius: number): void {
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const b = ((i + 1) / segments) * Math.PI * 2
    push(out, Math.cos(a) * radius, Math.sin(a) * radius, Math.cos(b) * radius, Math.sin(b) * radius)
  }
}

/** One color for every vertex; `hex` is sRGB, vertex colors must be linear (Color converts). */
function solid(positions: number[], hex: string): LineBuffers {
  const c = new Color(hex)
  const colors = new Float32Array(positions.length)
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i)
  return { positions: new Float32Array(positions), colors }
}

/** Unit circle (radius 1) on the ground plane: the accuracy edge, scaled to the accuracy radius. */
export function accuracyEdgeBuffers(hex: string): LineBuffers {
  const out: number[] = []
  circle(out, EDGE_SEGMENTS, 1)
  return solid(out, hex)
}

/** A ring of radius 1 with four ticks pointing outward to `TICK_OUTER`. */
export function reticleBuffers(hex: string): LineBuffers {
  const out: number[] = []
  circle(out, RING_SEGMENTS, 1)
  push(out, 1, 0, TICK_OUTER, 0)
  push(out, -1, 0, -TICK_OUTER, 0)
  push(out, 0, 1, 0, TICK_OUTER)
  push(out, 0, -1, 0, -TICK_OUTER)
  return solid(out, hex)
}
