import type { ArrivalGroup } from './arrivals'

/** Arrival groups a stacked (phone) station panel shows before "Show all N arrivals", so the map above it stays free. */
export const COLLAPSED_ARRIVALS = 3

/** Every group in the sections. */
export function arrivalGroupCount(sections: readonly (readonly ArrivalGroup[])[]): number {
  return sections.reduce((n, s) => n + s.length, 0)
}

const soonest = (g: ArrivalGroup) => g.times[0] ?? Infinity

/**
 * The sections cut to the `limit` groups due soonest (by their first time; a tie keeps list order), each kept in its
 * section and place; sections left empty are dropped. Unchanged when there are no more than `limit` groups.
 */
export function soonestSections(sections: readonly (readonly ArrivalGroup[])[], limit: number): ArrivalGroup[][] {
  const all = sections.flatMap((s, si) => s.map((g, gi) => ({ g, order: si * 1e6 + gi })))
  if (all.length <= limit) return sections.map((s) => [...s])
  const kept = new Set(
    all
      .sort((a, b) => soonest(a.g) - soonest(b.g) || a.order - b.order)
      .slice(0, limit)
      .map((e) => e.g),
  )
  return sections.map((s) => s.filter((g) => kept.has(g))).filter((s) => s.length > 0)
}
