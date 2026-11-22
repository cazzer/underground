/** The streets' color while drawn above the interior veil: they dim toward the background as the veil rises, so at
 *  full 3D they rest faint behind the interior instead of vanishing under the veil. Pure. */
import type { Rgb } from './lineBuffers'
import { contrastRatio, mixHex } from './routeColor'

/** Contrast the streets rest at against the background at full veil (veilWeight 1). */
export const STREET_OVER_VEIL_CONTRAST = 1.9

/** `stroke` mixed toward `background` (in sRGB) until it is `contrast`:1 against it; `stroke` itself if it is already
 *  fainter. Bisection, run once at load. */
export function veiledStreetHex(stroke: string, background: string, contrast = STREET_OVER_VEIL_CONTRAST): string {
  if (contrastRatio(stroke, background) <= contrast) return stroke
  let lo = 0
  let hi = 1
  for (let k = 0; k < 30; k++) {
    const t = (lo + hi) / 2
    if (contrastRatio(mixHex(stroke, background, t), background) > contrast) lo = t
    else hi = t
  }
  return mixHex(stroke, background, lo)
}

/**
 * The per-channel multiplier (written into `out`) that takes the street layer's vertex color `stroke` (linear) to
 * `veiled` (linear) at `weight` 1, linearly in between: 1, 1, 1 at weight 0. For a LineMaterial's `color`, which
 * multiplies its vertex colors. No allocation.
 */
export function streetColorScale(out: { r: number; g: number; b: number }, stroke: Rgb, veiled: Rgb, weight: number): void {
  const w = Math.min(Math.max(weight, 0), 1)
  out.r = stroke[0] > 0 ? 1 + (veiled[0] / stroke[0] - 1) * w : 1
  out.g = stroke[1] > 0 ? 1 + (veiled[1] / stroke[1] - 1) * w : 1
  out.b = stroke[2] > 0 ? 1 + (veiled[2] / stroke[2] - 1) * w : 1
}
