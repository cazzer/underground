/**
 * TEMPORARY override of the street layer's draw order for the ost.7 look card. The default, `auto` (the ost.4 UX
 * review's pick), draws the streets above the interior veil, dimming toward the background with the veil
 * (streetVeil.ts), whenever the focused station's interior is loaded under look A (the screen veil); otherwise (no
 * interior, loading, failed, looks B and C) under the route lines at full color. `?streets=under` and
 * `?streets=over` force one order whatever the interior. Once the card is decided, remove together:
 * - this file
 * - StationStreets.tsx: the `streetsLook` import and the `under` / `over` cases of `overVeil` (keep the auto rule)
 * - theme.ts: the `?streets=` sentence in the `streetStroke` doc; theme.test.ts: the "(?streets=under)" veiled-floor
 *   case, which then only guards look A without an interior loaded (drop it if the veil never covers the streets)
 * - AGENTS.md, three places: the `?streets=` TEMPORARY note in the theme bullets, "`streetsLook.ts` TEMPORARY
 *   override" in the StationStreets.tsx directory entry, and "TEMPORARY `?streets=`" in the render-order list
 */
export type StreetsLook = 'auto' | 'under' | 'over'

export function resolveStreetsLook(search: string): StreetsLook {
  const v = new URLSearchParams(search).get('streets')
  return v === 'over' || v === 'under' ? v : 'auto'
}

export const streetsLook: StreetsLook = resolveStreetsLook(window.location.search)
