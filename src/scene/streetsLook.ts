/**
 * TEMPORARY override of the street layer's draw order for the ost.7 look card. The default, `auto` (the ost.4 UX
 * review's pick), draws the streets above the interior veil at a fainter stroke (about 1.9:1,
 * streetVeil.ts), whenever any interior draws under look A (the screen veil: the focused station's or one in view); otherwise (no
 * interior, loading, failed, looks B and C) under the route lines at full color. `?streets=under` and
 * `?streets=over` force one order, at full color, whatever the interior. Once the card is decided, remove together:
 * - this file
 * - StationStreets.tsx: the `streetsLook` import and the forced cases of `streetMode` (keep the auto rule)
 * - theme.ts: the `?streets=` sentence in the `streetStroke` doc; theme.test.ts: the "(?streets=under)" veiled-floor
 *   case, which then only guards look A without an interior loaded (drop it if the veil never covers the streets)
 * - AGENTS.md: `?streets=` in the TEMPORARY query flags bullet (Hard rules)
 */
export type StreetsLook = 'auto' | 'under' | 'over'

export function resolveStreetsLook(search: string): StreetsLook {
  const v = new URLSearchParams(search).get('streets')
  return v === 'over' || v === 'under' ? v : 'auto'
}

export const streetsLook: StreetsLook = resolveStreetsLook(window.location.search)
