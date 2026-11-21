/** Pure framing and labelling helpers for a station interior. Type-only imports. */
import type { Level, LocalPoint, StationInterior } from '../data/stationSchema.ts'
import type { Ground } from './projection.ts'

export interface LocalBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Plan extent (local meters) of the platform and slab outlines and the entrances. */
export function interiorBounds(interior: StationInterior): LocalBounds {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const add = (x: number, z: number) => {
    b.minX = Math.min(b.minX, x)
    b.maxX = Math.max(b.maxX, x)
    b.minZ = Math.min(b.minZ, z)
    b.maxZ = Math.max(b.maxZ, z)
  }
  for (const p of interior.platforms) for (const [x, z] of p.outline) add(x, z)
  for (const s of interior.slabs) for (const [x, z] of s.outline) add(x, z)
  for (const e of interior.entrances) add(e.x, e.z)
  if (b.minX === Infinity) throw new Error(`Station interior ${interior.stationId} has no outlines or entrances`)
  return b
}

export interface FocusAnchor {
  /** Ground point under the interior's plan center (no depth shift). */
  center: Ground
  /** Meters the camera target must sit toward the camera so the mid-height center is mid-screen (negative above the street). */
  towardCamera: number
  /**
   * Plan distance (meters) from `center` to the farthest outline vertex or entrance (a hull vertex):
   * sizes the station orbit's pan radius, so every part can be brought to the middle of the view.
   */
  reach: number
}

/**
 * Where to aim the camera so the interior's plan center at mid-height (halfway between its lowest and highest
 * level) sits mid-screen. Viewed at polar angle θ, a point h meters down lines up with the ground point h·tanθ
 * toward the camera (away from it for a point above the street), so the target moves that far along the view
 * azimuth (south at north-up); the caller rotates it.
 */
export function interiorFocusAnchor(origin: Ground, interior: StationInterior, yScale: number, tanPolar: number): FocusAnchor {
  const b = interiorBounds(interior)
  const ys = interior.levels.map((l) => l.y)
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  let reach = 0
  const add = (x: number, z: number) => {
    reach = Math.max(reach, Math.hypot(x - cx, z - cz))
  }
  for (const p of interior.platforms) for (const [x, z] of p.outline) add(x, z)
  for (const s of interior.slabs) for (const [x, z] of s.outline) add(x, z)
  for (const e of interior.entrances) add(e.x, e.z)
  return {
    center: { x: origin.x + cx, z: origin.z + cz },
    towardCamera: -midY * yScale * tanPolar,
    reach,
  }
}

/** Depth for a label: "−4.3 m" (U+2212 minus, one decimal). */
export function formatDepth(y: number): string {
  const v = Math.abs(y).toFixed(1)
  return y < 0 && v !== '0.0' ? `−${v} m` : `${v} m`
}

/** `v` (already rounded text of |y|) signed: U+2212 minus below the street, "+" above; none when it rounds to zero. */
function signed(y: number, v: string): string {
  if (/^0(\.0)?$/.test(v)) return v
  return y < 0 ? `−${v}` : `+${v}`
}

/**
 * A level's height for its label. Authored levels keep `formatDepth`. On a generated interior a measured
 * depth (`ee-rise`) is signed to one decimal ("−4.3 m", "+6.1 m" above the street); every other source is an
 * estimate, signed whole meters after "≈" ("≈ −9 m").
 */
export function levelHeightText(level: Level, generated: boolean): string {
  if (!generated) return formatDepth(level.y)
  if (level.depthSource === 'ee-rise') return `${signed(level.y, Math.abs(level.y).toFixed(1))} m`
  return `≈ ${signed(level.y, String(Math.round(Math.abs(level.y))))} m`
}

export interface LevelLabel {
  levelId: string
  text: string
  /** Group-local [x, scaled y, z]: the label's top center. */
  position: [number, number, number]
}

/**
 * Midpoint of the outline edge that faces south (toward the camera) the most, weighted by length,
 * pushed `gap` meters outward. Deliberately fixed to south rather than following the station orbit,
 * so labels don't hop between edges mid-turn; turned past ±90° they sit on the far edge.
 */
function southEdgeAnchor(outline: readonly LocalPoint[], gap: number): LocalPoint {
  // Shoelace: twice the signed area. Its sign says which side of each edge is outside, for
  // either winding and for concave outlines too.
  let area2 = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    area2 += a[0] * b[1] - b[0] * a[1]
  }
  if (area2 === 0) throw new Error('Outline has no area')
  const side = Math.sign(area2)
  let best: { score: number; at: LocalPoint } | null = null
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len === 0) continue
    // Outward unit normal.
    const nx = (side * (b[1] - a[1])) / len
    const nz = (-side * (b[0] - a[0])) / len
    const score = nz * len
    if (!best || score > best.score) best = { score, at: [mx + nx * gap, mz + nz * gap] }
  }
  if (!best) throw new Error('Outline has no edges')
  return best.at
}

/**
 * One label per below-street level that has outlines, under the south-facing edge of the level's
 * westmost outline. That edge's midpoint sits inside the interior's bounds, so a framed view
 * never clips it. Text gives the true depth; only the position is scaled.
 */
export function levelLabels(interior: StationInterior, yScale: number, gap = 2): LevelLabel[] {
  const labels: LevelLabel[] = []
  const generated = interior.generated !== undefined
  for (const level of interior.levels) {
    if (level.kind === 'street') continue
    const outlines = [
      ...interior.platforms.filter((p) => p.level === level.id).map((p) => p.outline),
      ...interior.slabs.filter((s) => s.level === level.id).map((s) => s.outline),
    ]
    if (outlines.length === 0) continue
    const minX = (o: readonly LocalPoint[]) => Math.min(...o.map((p) => p[0]))
    const west = outlines.reduce((w, o) => (minX(o) < minX(w) ? o : w))
    const [x, z] = southEdgeAnchor(west, gap)
    labels.push({ levelId: level.id, text: `${level.name} ${levelHeightText(level, generated)}`, position: [x, level.y * yScale, z] })
  }
  return labels
}

const cross = (o: LocalPoint, a: LocalPoint, b: LocalPoint) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/**
 * Convex hull (monotone chain, counter-clockwise in x/z, collinear points dropped), with each
 * vertex pushed `pad` meters farther from the hull's vertex centroid.
 */
export function paddedHull(points: readonly LocalPoint[], pad: number): LocalPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const half = (pts: LocalPoint[]): LocalPoint[] => {
    const out: LocalPoint[] = []
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = [...half(sorted), ...half([...sorted].reverse())]
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cz = hull.reduce((s, p) => s + p[1], 0) / hull.length
  return hull.map(([x, z]) => {
    const d = Math.hypot(x - cx, z - cz)
    const k = d === 0 ? 1 : (d + pad) / d
    return [cx + (x - cx) * k, cz + (z - cz) * k]
  })
}
