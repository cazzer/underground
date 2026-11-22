/** The streets' color while drawn above the interior veil: a fainter stroke, so they rest behind the interior
 *  instead of vanishing under the veil. Pure. */
import { contrastRatio, mixHex } from './routeColor'

/** Contrast the streets rest at against the background while drawn above the veil. */
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
