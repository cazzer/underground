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
 * position into `out`. The instance at `focusedIndex` (-1 for none) is scaled by
 * `focusScale` as well. Runs per frame, so it does not allocate.
 */
export function writeMarkerMatrices(
  out: Float32Array,
  positions: readonly Ground[],
  y: number,
  scale: number,
  focusedIndex: number,
  focusScale: number,
): void {
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!
    writeInstanceMatrix(out, i, p.x, y, p.z, i === focusedIndex ? scale * focusScale : scale)
  }
}

/**
 * Writes a yaw-plus-scale-plus-translate 4x4 matrix (column-major) at instance `i` of `out`: a rotation
 * about +y that points local +z along the ground direction (ux, uz). The direction need not be unit length; a zero direction faces north (0, -1). Scales are per local axis. No allocation or trig.
 */
export function writeYawMatrix(
  out: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  ux: number,
  uz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const len = Math.hypot(ux, uz)
  const fx = len > 0 ? ux / len : 0
  const fz = len > 0 ? uz / len : -1
  const o = i * 16
  out[o] = sx * fz
  out[o + 1] = 0
  out[o + 2] = -sx * fx
  out[o + 3] = 0
  out[o + 4] = 0
  out[o + 5] = sy
  out[o + 6] = 0
  out[o + 7] = 0
  out[o + 8] = sz * fx
  out[o + 9] = 0
  out[o + 10] = sz * fz
  out[o + 11] = 0
  out[o + 12] = x
  out[o + 13] = y
  out[o + 14] = z
  out[o + 15] = 1
}
