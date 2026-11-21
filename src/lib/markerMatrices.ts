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
