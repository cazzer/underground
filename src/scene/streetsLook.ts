/**
 * TEMPORARY until the street layer's draw order is picked (the ost.7 look card). `?streets=under|over` (default
 * under): `under` draws the streets at street level under the route lines, so the interior veil dims them; `over`
 * draws them above the veil, under the interior strokes. Once decided, remove together:
 * - this file
 * - StationStreets.tsx: the `streetsLook` import and the `ORDER` switch (use the chosen render order directly)
 * - renderOrder.ts: `streetsOver` and its TEMPORARY comment (if under wins), or `streets` and its comment (if over
 *   wins; move `streetsOver` to a permanent name and comment)
 * - theme.ts: the `streetStroke` doc's draw-order wording and its veil reasoning (the veiled-contrast bound only
 *   applies under the veil, so if over wins drop it there and in theme.test.ts)
 * - AGENTS.md, three places: the `?streets=` TEMPORARY note in the theme bullets, "`streetsLook.ts` TEMPORARY
 *   draw-order switch" in the StationStreets.tsx directory entry, and "(7.5 under the TEMPORARY `?streets=over`)"
 *   in the render-order list
 */
export type StreetsLook = 'under' | 'over'

export function resolveStreetsLook(search: string): StreetsLook {
  return new URLSearchParams(search).get('streets') === 'over' ? 'over' : 'under'
}

export const streetsLook: StreetsLook = resolveStreetsLook(window.location.search)
