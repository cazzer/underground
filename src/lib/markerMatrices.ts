import type { Ground } from './projection'

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
    const s = i === focusedIndex ? scale * focusScale : scale
    const o = i * 16
    out.fill(0, o, o + 16)
    out[o] = s
    out[o + 5] = s
    out[o + 10] = s
    out[o + 12] = p.x
    out[o + 13] = y
    out[o + 14] = p.z
    out[o + 15] = 1
  }
}
