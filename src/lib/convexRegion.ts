/** Pure 2D convex-region helpers on the ground plane (x, z): half-plane clipping and nearest points. */
import type { Ground } from './projection'

/** The points T with n · T ≤ c. */
export interface HalfPlane {
  nx: number
  nz: number
  c: number
}

/** A square of half-size `half` around `center`, counter-clockwise in (x, z). */
export function square(center: Ground, half: number): Ground[] {
  return [
    { x: center.x - half, z: center.z - half },
    { x: center.x + half, z: center.z - half },
    { x: center.x + half, z: center.z + half },
    { x: center.x - half, z: center.z + half },
  ]
}

/** `poly` (convex) clipped to the half-plane, Sutherland-Hodgman; empty when nothing is left. Allocates. */
export function clipToHalfPlane(poly: readonly Ground[], h: HalfPlane): Ground[] {
  const out: Ground[] = []
  const side = (p: Ground) => h.nx * p.x + h.nz * p.z - h.c
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const sa = side(a)
    const sb = side(b)
    if (sa <= 0) out.push(a)
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb)
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
    }
  }
  return out
}

/** The half-planes bounding the convex polygon `poly` (either winding), each facing out. */
export function polygonHalfPlanes(poly: readonly Ground[]): HalfPlane[] {
  let cx = 0
  let cz = 0
  for (const p of poly) {
    cx += p.x / poly.length
    cz += p.z / poly.length
  }
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    let nx = b.z - a.z
    let nz = a.x - b.x
    if (nx * (cx - a.x) + nz * (cz - a.z) > 0) {
      nx = -nx
      nz = -nz
    }
    return { nx, nz, c: nx * a.x + nz * a.z }
  })
}

function nearestOnSegment(p: Ground, a: Ground, b: Ground): Ground {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return { x: a.x + dx * t, z: a.z + dz * t }
}

/** The point of the convex polygon `poly` (non-empty) nearest `p`: `p` itself when inside. */
export function nearestInPolygon(poly: readonly Ground[], planes: readonly HalfPlane[], p: Ground): Ground {
  if (planes.every((h) => h.nx * p.x + h.nz * p.z <= h.c + 1e-9)) return { x: p.x, z: p.z }
  if (poly.length === 1) return { ...poly[0]! }
  let best: Ground = poly[0]!
  let bestD = Infinity
  for (let i = 0; i < poly.length; i++) {
    const q = nearestOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!)
    const d = Math.hypot(q.x - p.x, q.z - p.z)
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}
