/**
 * A uniform grid of polyline segments over the lines' bounds, for the corridor search (corridors.ts). Pure.
 */
import type { Ground } from './projection'

export interface SegmentGrid {
  cellM: number
  minX: number
  minZ: number
  nx: number
  nz: number
  /**
   * Cell c lists the segment ids items[start[c]] .. items[start[c + 1] - 1]: every segment within reach of the
   * cell, sorted by its line's group, then by line. groupEnd[j] and lineEnd[j] are the indices just past item j's
   * group and line in its cell, so a search can skip a whole group or line at once.
   */
  start: Int32Array
  items: Int32Array
  groupEnd: Int32Array
  lineEnd: Int32Array
  /** Per segment: start, unit direction, length, distance along its line at its start, and the line's index. */
  ax: Float64Array
  az: Float64Array
  ux: Float64Array
  uz: Float64Array
  len: Float64Array
  startD: Float64Array
  owner: Int32Array
  /** The group of each segment's line. */
  group: Int32Array
}

/** The cell index for (x, z), or -1 outside the grid. */
export function cellIndex(grid: SegmentGrid, x: number, z: number): number {
  const ix = Math.floor((x - grid.minX) / grid.cellM)
  const iz = Math.floor((z - grid.minZ) / grid.cellM)
  if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) return -1
  return ix * grid.nz + iz
}

/**
 * Grids every non-zero segment of `lines`. Each segment is cut into pieces no longer than a cell, and each
 * piece's bounding box, grown by `reachM`, marks the cells it touches, so every point within `reachM` of a
 * segment finds it in its own cell. Two passes (count, then fill) into flat arrays: no per-cell allocation.
 * `group[i]` is line i's group (the corridor search uses the route's band rank).
 */
export function buildSegmentGrid(
  lines: readonly (readonly Ground[])[],
  group: ArrayLike<number>,
  reachM: number,
  cellM: number,
): SegmentGrid {
  let count = 0
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const pts of lines) {
    count += Math.max(pts.length - 1, 0)
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      minZ = Math.min(minZ, p.z)
      maxX = Math.max(maxX, p.x)
      maxZ = Math.max(maxZ, p.z)
    }
  }
  if (count === 0) {
    minX = minZ = maxX = maxZ = 0
  }
  minX -= reachM
  minZ -= reachM
  const nx = Math.floor((maxX + reachM - minX) / cellM) + 1
  const nz = Math.floor((maxZ + reachM - minZ) / cellM) + 1

  const ax = new Float64Array(count)
  const az = new Float64Array(count)
  const ux = new Float64Array(count)
  const uz = new Float64Array(count)
  const len = new Float64Array(count)
  const startD = new Float64Array(count)
  const owner = new Int32Array(count)
  const segGroup = new Int32Array(count)
  // Segment ids follow the groups' order, so filling cells in id order leaves each cell's list grouped.
  const order = lines.map((_, i) => i).sort((p, q) => group[p]! - group[q]! || p - q)
  let segs = 0
  for (const li of order) {
    const pts = lines[li]!
    let d = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const l = Math.hypot(b.x - a.x, b.z - a.z)
      if (l === 0) continue
      ax[segs] = a.x
      az[segs] = a.z
      ux[segs] = (b.x - a.x) / l
      uz[segs] = (b.z - a.z) / l
      len[segs] = l
      startD[segs] = d
      owner[segs] = li
      segGroup[segs] = group[li]!
      d += l
      segs++
    }
  }

  const counts = new Int32Array(nx * nz + 1)
  // Last segment written to each cell: consecutive pieces of one segment share cells, so this dedupes them.
  const last = new Int32Array(nx * nz).fill(-1)
  const visit = (fill: Int32Array | null, cursor: Int32Array) => {
    last.fill(-1)
    for (let s = 0; s < segs; s++) {
      const l = len[s]!
      const pieces = Math.ceil(l / cellM)
      for (let k = 0; k < pieces; k++) {
        const t0 = (l * k) / pieces
        const t1 = (l * (k + 1)) / pieces
        const x0 = ax[s]! + ux[s]! * t0
        const z0 = az[s]! + uz[s]! * t0
        const x1 = ax[s]! + ux[s]! * t1
        const z1 = az[s]! + uz[s]! * t1
        const ix0 = Math.floor((Math.min(x0, x1) - reachM - minX) / cellM)
        const ix1 = Math.floor((Math.max(x0, x1) + reachM - minX) / cellM)
        const iz0 = Math.floor((Math.min(z0, z1) - reachM - minZ) / cellM)
        const iz1 = Math.floor((Math.max(z0, z1) + reachM - minZ) / cellM)
        for (let ix = Math.max(ix0, 0); ix <= Math.min(ix1, nx - 1); ix++) {
          for (let iz = Math.max(iz0, 0); iz <= Math.min(iz1, nz - 1); iz++) {
            const c = ix * nz + iz
            if (last[c] === s) continue
            last[c] = s
            if (fill) fill[cursor[c]!++] = s
            else cursor[c + 1]!++
          }
        }
      }
    }
  }
  visit(null, counts)
  for (let c = 1; c < counts.length; c++) counts[c]! += counts[c - 1]!
  const start = counts
  const items = new Int32Array(start[nx * nz]!)
  visit(items, start.slice(0, nx * nz))

  const groupEnd = new Int32Array(items.length)
  const lineEnd = new Int32Array(items.length)
  for (let c = 0; c < nx * nz; c++) {
    const lo = start[c]!
    for (let j = start[c + 1]! - 1; j >= lo; j--) {
      const next = j + 1 < start[c + 1]! ? items[j + 1]! : -1
      groupEnd[j] = next >= 0 && segGroup[next] === segGroup[items[j]!] ? groupEnd[j + 1]! : j + 1
      lineEnd[j] = next >= 0 && owner[next] === owner[items[j]!] ? lineEnd[j + 1]! : j + 1
    }
  }
  return { cellM, minX, minZ, nx, nz, start, items, groupEnd, lineEnd, ax, az, ux, uz, len, startD, owner, group: segGroup }
}

/** Ground distance from (x, z) to segment `s`. */
export function segmentDistance(grid: SegmentGrid, s: number, x: number, z: number): number {
  const px = x - grid.ax[s]!
  const pz = z - grid.az[s]!
  const t = Math.min(Math.max(px * grid.ux[s]! + pz * grid.uz[s]!, 0), grid.len[s]!)
  return Math.hypot(px - grid.ux[s]! * t, pz - grid.uz[s]! * t)
}
