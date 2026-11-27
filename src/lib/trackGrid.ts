/**
 * The drawn tracks as segments in a coarse grid (amenity mark placement, enp.5): a query for the segments near a point
 * reads a few cells instead of every segment in the city. Built a shape at a time (`addShape`), so the scene can
 * spread it over idle slices. Shapes with the same ground path (a route's variants) count once, as distinctTracks
 * does. Pure.
 */
import type { Ground } from './projection'

/** Cell size, meters: a query of 80 m reads at most a 3 × 3 block. */
export const TRACK_CELL_M = 100

export interface TrackGrid {
  /** Every segment as x0, z0, x1, z1. */
  segments: number[]
  /** Segment indices by cell key. */
  cells: Map<number, number[]>
  /** Per segment, the last query that took it (dedupes a segment spanning cells). */
  stamp: number[]
  query: number
  /** The shapes added, bucketed by length and ends, to skip a twin. */
  seen: Map<string, (readonly Ground[])[]>
}

const cellOf = (v: number) => Math.floor(v / TRACK_CELL_M)
/** Cell coordinates stay well inside ±2^15 for the city (about ±3,000 km). */
const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768)
const samePoints = (a: readonly Ground[], b: readonly Ground[]) => a.length === b.length && a.every((p, i) => p.x === b[i]!.x && p.z === b[i]!.z)

export function newTrackGrid(): TrackGrid {
  return { segments: [], cells: new Map(), stamp: [], query: 0, seen: new Map() }
}

/** Adds one shape's segments, unless a shape with the same ground path is in already. */
export function addShape(grid: TrackGrid, points: readonly Ground[]): void {
  const a0 = points[0]
  const an = points[points.length - 1]
  const bucket = `${points.length} ${a0?.x} ${a0?.z} ${an?.x} ${an?.z}`
  const twins = grid.seen.get(bucket)
  if (twins?.some((t) => samePoints(t, points))) return
  if (twins) twins.push(points)
  else grid.seen.set(bucket, [points])
  const { segments, cells } = grid
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const s = segments.length / 4
    segments.push(a.x, a.z, b.x, b.z)
    for (let ix = cellOf(Math.min(a.x, b.x)); ix <= cellOf(Math.max(a.x, b.x)); ix++) {
      for (let iz = cellOf(Math.min(a.z, b.z)); iz <= cellOf(Math.max(a.z, b.z)); iz++) {
        const k = key(ix, iz)
        const list = cells.get(k)
        if (list) list.push(s)
        else cells.set(k, [s])
      }
    }
  }
}

/** The grid of every shape at once. */
export function trackGrid(shapes: readonly { points: readonly Ground[] }[]): TrackGrid {
  const grid = newTrackGrid()
  for (const s of shapes) addShape(grid, s.points)
  return grid
}

/** The segments whose cells come within `radius` of `origin`, each once, relative to `origin` (x0, z0, x1, z1 each). */
export function segmentsNear(grid: TrackGrid, origin: Ground, radius: number): number[] {
  const q = ++grid.query
  const out: number[] = []
  const { segments, cells, stamp } = grid
  for (let ix = cellOf(origin.x - radius); ix <= cellOf(origin.x + radius); ix++) {
    for (let iz = cellOf(origin.z - radius); iz <= cellOf(origin.z + radius); iz++) {
      for (const s of cells.get(key(ix, iz)) ?? []) {
        if (stamp[s] === q) continue
        stamp[s] = q
        const o = s * 4
        out.push(segments[o]! - origin.x, segments[o + 1]! - origin.z, segments[o + 2]! - origin.x, segments[o + 3]! - origin.z)
      }
    }
  }
  return out
}
