/**
 * The drawn tracks a street clip (routeClip.ts) tests against: packed flat for the basemap worker, or cut to the
 * runs near one station for its street layer. Pure.
 */
import type { Ground } from './projection'

/** Every track's ground points as x, z pairs; track i is points starts[i] .. starts[i + 1] - 1. */
export interface PackedTracks {
  xz: Float32Array
  starts: Int32Array
}

interface TrackShape {
  points: readonly Ground[]
}

export function packTracks(shapes: readonly TrackShape[]): PackedTracks {
  const starts = new Int32Array(shapes.length + 1)
  shapes.forEach((s, i) => (starts[i + 1] = starts[i]! + s.points.length))
  const xz = new Float32Array(starts[shapes.length]! * 2)
  let k = 0
  for (const s of shapes) {
    for (const p of s.points) {
      xz[k++] = p.x
      xz[k++] = p.z
    }
  }
  return { xz, starts }
}

/** Throws on a malformed pack (it crosses a worker boundary). */
export function unpackTracks({ xz, starts }: PackedTracks): Ground[][] {
  const points = xz.length / 2
  if (!Number.isInteger(points) || starts.length < 1 || starts[0] !== 0 || starts[starts.length - 1] !== points) {
    throw new Error(`Packed tracks: ${starts.length - 1} tracks over ${starts[starts.length - 1]} points, but ${xz.length} floats`)
  }
  const out: Ground[][] = []
  for (let i = 1; i < starts.length; i++) {
    const lo = starts[i - 1]!
    const hi = starts[i]!
    if (hi < lo) throw new Error(`Packed tracks: track ${i - 1} ends at ${hi} before it starts at ${lo}`)
    const track: Ground[] = []
    for (let j = lo; j < hi; j++) track.push({ x: xz[2 * j]!, z: xz[2 * j + 1]! })
    out.push(track)
  }
  return out
}

/** Distance from the origin to segment a→b. */
function originDistance(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.min(Math.max(-(ax * dx + az * dz) / l2, 0), 1) : 0
  return Math.hypot(ax + dx * t, az + dz * t)
}

/**
 * The runs of the shapes' segments that pass within `reachM` of `anchor`, in meters from it: each maximal stretch
 * of consecutive such segments is one run.
 */
export function localTracks(shapes: readonly TrackShape[], anchor: Ground, reachM: number): Ground[][] {
  const out: Ground[][] = []
  for (const { points } of shapes) {
    let run: Ground[] | null = null
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      const ax = a.x - anchor.x
      const az = a.z - anchor.z
      const bx = b.x - anchor.x
      const bz = b.z - anchor.z
      if (originDistance(ax, az, bx, bz) > reachM) {
        run = null
        continue
      }
      if (run === null) {
        run = [{ x: ax, z: az }]
        out.push(run)
      }
      run.push({ x: bx, z: bz })
    }
  }
  return out
}
