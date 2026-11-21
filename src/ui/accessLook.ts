/**
 * TEMPORARY until the access marker look is picked (underground-epz look card). `?access=a|b|c` (default a):
 * A the plain glyph in ink (dimmed when partly accessible), B the glyph in a filled square badge (outlined when
 * partly accessible), C a text pill like the route chips. Once decided, remove together:
 * - this file, and the `look` switch in AccessIcon.tsx (keep the chosen branch)
 * - theme.ts `accessBadge` / `accessBadgeInk`, their `--ug-access-badge*` vars in `applyThemeCss` and
 *   index.css, and the badge half of the theme.test.ts access check (unless B wins)
 * - AGENTS.md: the `?access=` TEMPORARY note
 */
export type AccessLook = 'a' | 'b' | 'c'

export function resolveAccessLook(search: string): AccessLook {
  const requested = new URLSearchParams(search).get('access')
  return requested === 'b' || requested === 'c' ? requested : 'a'
}

export const accessLook: AccessLook = resolveAccessLook(window.location.search)
