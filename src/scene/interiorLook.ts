/**
 * TEMPORARY until the interior look and vertical scale are picked (8x4.11 review cards).
 * `?interior=a|b|c` picks how the street gives way (default a, the veil); `?interiorY=1|2|3`
 * picks the vertical exaggeration (default 2). Once both are decided, remove together:
 * - this file: replace `interiorLook` with constants for the chosen look and scale
 * - useNetwork.ts: reads `interiorLook.yScale` for the track profile (the tracks descend to the interior's
 *   rails); pass the chosen scale constant instead
 * - InteriorVeil.tsx: the unchosen `veil` branch and, unless B wins, the `hull` prop (or the whole
 *   file if C wins)
 * - StationInterior.tsx: the `look.under` render-order switch, the `veil === 'none'` check, and the
 *   `hull={model.hull}` pass-through unless B wins
 * - interiorModel.ts: `hull` and the cut-line buffer (unless B wins)
 * - interiorFraming.ts: `paddedHull` and its tests (unless B wins)
 * - renderOrder.ts: `interiorUnderFine` / `interiorUnder` (unless C wins), or `interiorVeil` (if C wins)
 * - scripts/lib/templates/stairs.ts: `DRAWN_Y_SCALE` (generated stair and escalator runs are sized for the drawn
 *   rise) must equal the chosen scale; regenerate with `npm run data:stations`
 * - useSpanCars.ts: `VEIL_TINT` and `SPAN_LIFT` become constants (if C wins, delete SpanCars, useSpanCars and their
 *   render orders: the interior draws under the trains; also the `over` layers, `splitLevel` and `trainLevelIndex`)
 * - interiorModel.ts: the `interiorLook.under` check on `splitLevel`
 * - AGENTS.md: the `?interior=` / `?interiorY=` TEMPORARY note, "padded hull" in the directory map
 *   (unless B wins), and "look C uses -0.6 and -0.3" in the rendering conventions (unless C wins)
 */
export interface InteriorLook {
  /** A: a screen-wide veil dims the street; B: a footprint-shaped cutaway; C: no veil. */
  veil: 'screen' | 'footprint' | 'none'
  /** Veil opacity at full reveal. */
  veilOpacity: number
  /** C: draw the interior under the street layers instead of over them. */
  under: boolean
  /** Vertical exaggeration of interior depths (labels still give true depths). */
  yScale: number
  /** Vertical guide lines from each outline vertex up to the street. */
  guides: boolean
}

const LOOKS = {
  a: { veil: 'screen', veilOpacity: 0.7, under: false, guides: true },
  b: { veil: 'footprint', veilOpacity: 1, under: false, guides: true },
  c: { veil: 'none', veilOpacity: 0, under: true, guides: true },
} as const satisfies Record<string, Omit<InteriorLook, 'yScale'>>

export function resolveInteriorLook(search: string): InteriorLook {
  const params = new URLSearchParams(search)
  const name = params.get('interior')
  const look = name === 'b' || name === 'c' ? LOOKS[name] : LOOKS.a
  const y = params.get('interiorY')
  return { ...look, yScale: y === '1' || y === '3' ? Number(y) : 2 }
}

export const interiorLook: InteriorLook = resolveInteriorLook(window.location.search)
