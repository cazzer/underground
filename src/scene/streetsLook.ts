/**
 * TEMPORARY until the street layer's draw order is picked (the ost.7 look card). `?streets=under|over` (default
 * under): `under` draws the streets at street level under the route lines, so the interior veil dims them; `over`
 * draws them above the veil, under the interior strokes. Once decided, remove together:
 * - this file
 * - renderOrder.ts: `streetsOver` (if under wins) or `streets` (if over wins)
 * - StationStreets.tsx: the `streetsLook` render-order switch
 * - AGENTS.md: the `?streets=` TEMPORARY note
 */
export type StreetsLook = 'under' | 'over'

export function resolveStreetsLook(search: string): StreetsLook {
  return new URLSearchParams(search).get('streets') === 'over' ? 'over' : 'under'
}

export const streetsLook: StreetsLook = resolveStreetsLook(window.location.search)
