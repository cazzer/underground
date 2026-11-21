/**
 * TEMPORARY until the look for generated (estimated) interiors is picked (9wc.5 review card).
 * `?approx=a|b|c` (default b) changes how a generated interior's strokes draw; authored interiors never change.
 * A dims them toward the background by `interiorApproxMix` (machines exempt). Contrast caveat: on the deepest
 * level that mix stacks with the depth fade (1 - 0.6 × 0.5 = 0.7 toward the background), which puts every
 * non-machine stroke under 3:1 (interiorStroke 2.5; at the
 * authored 0.5 it is 4.6), so A would need a smaller mix or a test before it ships. B dashes platform and slab outlines and the slabs' street
 * guides in world meters (`interiorApproxDash` / `interiorApproxGap`), in the same two layers and draw calls:
 * the materials turn dashed and per-segment `distances` say which segments to cut (tracks stay solid). C draws
 * everything at the fine width in one layer. Once decided, remove together:
 * - this file: use the chosen look as a constant in interiorModel.ts
 * - interiorModel.ts: the unchosen branches (the `approxMix` argument of `colorTable`, `dashed`, `fineOnly` and
 *   `concat`)
 * - unless B wins: the `dashStructure` option in interiorGeometry.ts and its test in interiorGeometry.test.ts,
 *   `distances` and the `dashed` arguments in interiorSegments.ts, `distances` in withCutLine/concat/EMPTY
 *   (interiorModel.ts), the `dash` parameter and `DashableLineBuffers` in useLineLayer.ts, and `DASH` in
 *   StationInterior.tsx
 * - theme.ts: `interiorApproxMix` (unless A wins), `interiorApproxDash` / `interiorApproxGap` (unless B wins)
 * - AGENTS.md: the `?approx=` TEMPORARY note, `approxLook.ts` in the directory map, and "both dashed for a generated
 *   interior under `?approx=b`" in the StationInterior.tsx entry (unless B wins)
 */
export type ApproxLook = 'a' | 'b' | 'c'

export function resolveApproxLook(search: string): ApproxLook {
  const name = new URLSearchParams(search).get('approx')
  return name === 'a' || name === 'c' ? name : 'b'
}

export const approxLook: ApproxLook = resolveApproxLook(window.location.search)
