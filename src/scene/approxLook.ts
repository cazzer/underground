/**
 * TEMPORARY until the look for generated (approximate) interiors is picked (9wc.5 review card).
 * `?approx=a|b|c` (default b) changes how a generated interior's strokes draw; authored interiors never change.
 * A dims them toward the background by `interiorApproxMix` (machines exempt); B dashes platform and slab outlines
 * and tracks in world meters (`interiorApproxDash` / `interiorApproxGap`), one extra draw call; C draws everything
 * at the fine stroke width in one layer. Once decided, remove together:
 * - this file: use the chosen look as a constant in interiorModel.ts
 * - interiorModel.ts: the unchosen branches (`approxColorMix`, `dashed`, `fineOnly`)
 * - interiorGeometry.ts: the `dashStructure` option and the `dashed` writer (unless B wins)
 * - useLineLayer.ts: the `dash` parameter (unless B wins); StationInterior.tsx: the dashed layer (unless B wins)
 * - renderOrder.ts: `interiorDashed` / `interiorUnderDashed` (unless B wins)
 * - theme.ts: `interiorApproxMix` (unless A wins), `interiorApproxDash` / `interiorApproxGap` (unless B wins)
 * - AGENTS.md: the `?approx=` TEMPORARY note and approxLook.ts in the directory map
 */
export type ApproxLook = 'a' | 'b' | 'c'

export function resolveApproxLook(search: string): ApproxLook {
  const name = new URLSearchParams(search).get('approx')
  return name === 'a' || name === 'c' ? name : 'b'
}

export const approxLook: ApproxLook = resolveApproxLook(window.location.search)
