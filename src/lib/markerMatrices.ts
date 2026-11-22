import type { Ground } from './projection'

/** Writes one uniform-scale-plus-translate 4x4 matrix (column-major) at instance `i` of `out`. No allocation. */
export function writeInstanceMatrix(out: Float32Array, i: number, x: number, y: number, z: number, scale: number): void {
  const o = i * 16
  out.fill(0, o, o + 16)
  out[o] = scale
  out[o + 5] = scale
  out[o + 10] = scale
  out[o + 12] = x
  out[o + 13] = y
  out[o + 14] = z
  out[o + 15] = 1
}

/**
 * Writes one scale-plus-translate 4x4 matrix (column-major, as three.js stores them) per
 * position into `out`. The instances at the `hidden` indices are scaled to 0, so neither their fill nor their ring
 * draws. Runs per frame, so it does not allocate.
 */
export function writeMarkerMatrices(
  out: Float32Array,
  positions: readonly Ground[],
  y: number,
  scale: number,
  hidden: readonly number[],
): void {
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!
    writeInstanceMatrix(out, i, p.x, y, p.z, scale)
  }
  for (const i of hidden) {
    const p = positions[i]
    if (p) writeInstanceMatrix(out, i, p.x, y, p.z, 0)
  }
}

/**
 * Writes a rotation-plus-scale-plus-translate 4x4 matrix (column-major) at instance `i` of `out` that points local
 * +z along the chord direction (ux, uy, uz) and keeps local +x level (no roll), so local +y is the chord's "up":
 * a car pitched along a ramp. With uy = 0 this is a yaw about +y. The direction need not be unit length; a zero
 * direction faces north (0, 0, -1), and a vertical one takes +x east. Scales are per local axis. No allocation or trig.
 */
export function writeChordMatrix(
  out: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  ux: number,
  uy: number,
  uz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const len = Math.hypot(ux, uy, uz)
  const fx = len > 0 ? ux / len : 0
  const fy = len > 0 ? uy / len : 0
  const fz = len > 0 ? uz / len : -1
  const h = Math.hypot(fx, fz)
  const o = i * 16
  if (h > 1e-9) {
    out[o] = (sx * fz) / h
    out[o + 1] = 0
    out[o + 2] = (-sx * fx) / h
    out[o + 4] = (-sy * fx * fy) / h
    out[o + 5] = sy * h
    out[o + 6] = (-sy * fy * fz) / h
  } else {
    // Straight up or down: x east, y = f x east.
    out[o] = sx
    out[o + 1] = 0
    out[o + 2] = 0
    out[o + 4] = 0
    out[o + 5] = 0
    out[o + 6] = -sy * fy
  }
  out[o + 3] = 0
  out[o + 7] = 0
  out[o + 8] = sz * fx
  out[o + 9] = sz * fy
  out[o + 10] = sz * fz
  out[o + 11] = 0
  out[o + 12] = x
  out[o + 13] = y
  out[o + 14] = z
  out[o + 15] = 1
}
