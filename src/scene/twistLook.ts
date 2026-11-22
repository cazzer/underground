/**
 * TEMPORARY switch for the pah.6 twist card. By default (`lock`) a two-finger touch that locks to rotate stops
 * zooming until the lift (useTouchOrbit holds the controls' zoomSpeed at 0). `?twist=both` lets it keep zooming
 * while it turns, so a twist and a pinch in one gesture do both; a gesture that locks to zoom still never turns, and
 * the dead zone and the zoom-first rule (lib/touchOrbit.ts) are the same. Once the card is decided, remove together:
 * - this file
 * - useTouchOrbit.ts: the `twistLook` import and its `holdZoom` test (keep or drop the zoomSpeed hold)
 * - AGENTS.md: the `?twist=` TEMPORARY note in the theme bullets, and "(not under `?twist=both`)" in the rotation
 *   paragraph of Rendering conventions
 */
export type TwistLook = 'lock' | 'both'

export function resolveTwistLook(search: string): TwistLook {
  return new URLSearchParams(search).get('twist') === 'both' ? 'both' : 'lock'
}

export const twistLook: TwistLook = resolveTwistLook(window.location.search)
