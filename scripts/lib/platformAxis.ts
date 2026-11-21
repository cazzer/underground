/** Station axis from platform outlines, and the [u, v] frame built on it.
 *  Same convention as AuthoredStation.frame and makeFrame: u runs along `bearingDeg` (clockwise from
 *  north, so bearing 0 is x = 0, z = -1 and bearing 90 is x = 1), v runs to its right. Axes have no
 *  direction, so bearings are in [0, 180). */
import type { LocalPoint } from '../../src/data/stationSchema.ts'

const DEG = Math.PI / 180
export type UV = [u: number, v: number]

export interface AxisFrame {
  bearingDeg: number
  /** Local point that maps to [0, 0]. */
  origin: LocalPoint
}

export function toUV(p: LocalPoint, f: AxisFrame): UV {
  const sin = Math.sin(f.bearingDeg * DEG)
  const cos = Math.cos(f.bearingDeg * DEG)
  const x = p[0] - f.origin[0]
  const z = p[1] - f.origin[1]
  return [x * sin - z * cos, x * cos + z * sin]
}

export function fromUV(p: UV, f: AxisFrame): LocalPoint {
  const sin = Math.sin(f.bearingDeg * DEG)
  const cos = Math.cos(f.bearingDeg * DEG)
  return [f.origin[0] + p[0] * sin + p[1] * cos, f.origin[1] - p[0] * cos + p[1] * sin]
}

/** Points every `stepM` meters along the closed outline (vertices included). */
export function sampleRing(ring: LocalPoint[], stepM = 1): LocalPoint[] {
  const out: LocalPoint[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepM))
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

const bearingOfDirection = (dx: number, dz: number): number => (((Math.atan2(dx, -dz) / DEG) % 180) + 180) % 180

/** Principal axis of the sampled outline (PCA) as a bearing, and the outline's length along it. */
export function platformAxis(outline: LocalPoint[]): { bearingDeg: number; lengthM: number } {
  const pts = sampleRing(outline)
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const mz = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let sxx = 0
  let szz = 0
  let sxz = 0
  for (const p of pts) {
    sxx += (p[0] - mx) ** 2
    szz += (p[1] - mz) ** 2
    sxz += (p[0] - mx) * (p[1] - mz)
  }
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz)
  const dx = Math.cos(theta)
  const dz = Math.sin(theta)
  const along = pts.map((p) => (p[0] - mx) * dx + (p[1] - mz) * dz)
  return { bearingDeg: bearingOfDirection(dx, dz), lengthM: Math.max(...along) - Math.min(...along) }
}

/** Smallest angle between two axes, in [0, 90]. */
export function axisDifferenceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 180
  return d > 90 ? 180 - d : d
}

export interface StationAxis {
  bearingDeg: number
  /** Per platform, how far its own axis is from the station axis. */
  deviationsDeg: number[]
}

/** Length-weighted mean of platform axes using doubled angles, so 179 and 1 degrees agree. */
export function stationAxis(outlines: LocalPoint[][]): StationAxis {
  const axes = outlines.map(platformAxis)
  let sx = 0
  let sy = 0
  for (const a of axes) {
    sx += a.lengthM * Math.cos(2 * a.bearingDeg * DEG)
    sy += a.lengthM * Math.sin(2 * a.bearingDeg * DEG)
  }
  const bearingDeg = Math.hypot(sx, sy) < 1e-9 ? (axes[0]?.bearingDeg ?? 0) : (((Math.atan2(sy, sx) / 2 / DEG) % 180) + 180) % 180
  return { bearingDeg, deviationsDeg: axes.map((a) => axisDifferenceDeg(a.bearingDeg, bearingDeg)) }
}
