/** How far each interior level fades toward the background. Pure; type-only `.ts` import like its neighbours. */
import type { Level } from '../data/stationSchema.ts'

/**
 * Per level (in file order, high to low), its distance in levels from the street level over the largest such
 * distance: 0 at the street, 1 for the farthest level. Below ground the street is index 0, so this is
 * i / (n - 1); at an elevated station the street is last and the top level fades most.
 */
export function levelFadeShares(levels: readonly Pick<Level, 'kind'>[]): number[] {
  const street = levels.findIndex((l) => l.kind === 'street')
  if (street < 0) throw new Error('Station interior has no street level')
  const farthest = Math.max(street, levels.length - 1 - street)
  return levels.map((_, i) => (farthest === 0 ? 0 : Math.abs(i - street) / farthest))
}
