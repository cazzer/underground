/**
 * The network's outline for the basemap's network fade (edgeFade.ts `networkAlpha`): the convex hull of the station
 * points as at most HULL_MAX_EDGES half-planes, each an outward normal (nx, nz) and offset c, so a point's distance
 * outside is max(nx·x + nz·z − c) (≤ 0 inside; outside it is the distance to the nearest edge line, so the padded
 * outline keeps sharp corners, which a fade this wide hides). The shader sizes its loop to the edge count (a define), up
 * to HULL_MAX_EDGES; a hull with more vertices drops the ones whose removal cuts the least area until it fits.
 */
import type { Ground } from '../projection'

/** The most edges the shader is given. */
export const HULL_MAX_EDGES = 32

export interface HullEdge {
  nx: number
  nz: number
  c: number
}

/** An edge no point is ever outside of (its term is −1e9 wherever the basemap draws): a degenerate network's whole outline. */
export const UNUSED_EDGE: HullEdge = { nx: 0, nz: 0, c: 1e9 }

const cross = (o: Ground, a: Ground, b: Ground) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)

/** Andrew's monotone chain: the hull's vertices in one winding, no collinear points. */
export function convexHull(points: readonly Ground[]): Ground[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  if (sorted.length < 3) return sorted
  const half = (pts: Ground[]) => {
    const out: Ground[] = []
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

/** Drops the vertex whose triangle with its neighbours is smallest until `hull` has at most `max` vertices. */
function reduce(hull: Ground[], max: number): Ground[] {
  const out = [...hull]
  while (out.length > max) {
    let best = 0
    let bestArea = Infinity
    for (let i = 0; i < out.length; i++) {
      const area = Math.abs(cross(out[(i + out.length - 1) % out.length]!, out[i]!, out[(i + 1) % out.length]!))
      if (area < bestArea) [best, bestArea] = [i, area]
    }
    out.splice(best, 1)
  }
  return out
}

/**
 * The network outline as half-planes (outward normals), one per hull edge. Under 3 points that span an area there is no
 * outline: the result is `[UNUSED_EDGE]`, so nothing fades (the caller says so; see `isNoOutline`).
 */
export function networkHull(points: readonly Ground[]): HullEdge[] {
  const hull = reduce(convexHull(points), HULL_MAX_EDGES)
  if (hull.length < 3) return [UNUSED_EDGE]
  const edges: HullEdge[] = []
  // monotone chain winds counterclockwise in (x, z): the outward normal of a→b is (dz, −dx).
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!
    const b = hull[(i + 1) % hull.length]!
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const nx = (b.z - a.z) / len
    const nz = -(b.x - a.x) / len
    edges.push({ nx, nz, c: nx * a.x + nz * a.z })
  }
  return edges
}

/** Whether `networkHull` found no outline (a degenerate network): the network fade is then off. */
export function isNoOutline(edges: readonly HullEdge[]): boolean {
  return edges.length === 1 && edges[0] === UNUSED_EDGE
}

/** How far (meters) the point lies outside the outline: ≤ 0 inside, the distance to the nearest edge line outside. */
export function hullOutside(x: number, z: number, edges: readonly HullEdge[]): number {
  let out = -Infinity
  for (const e of edges) out = Math.max(out, e.nx * x + e.nz * z - e.c)
  return out
}
