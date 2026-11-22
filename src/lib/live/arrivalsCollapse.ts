import type { ArrivalGroup } from './arrivals'

/** Arrival groups a stacked (phone) station panel shows before "Show all N destinations", so the map above stays free. */
export const COLLAPSED_ARRIVALS = 3

/** A group's identity across polls: the list's React key. */
export function arrivalGroupKey(g: ArrivalGroup): string {
  return `${g.routeId}|${g.headsign}`
}

/** Every group in the sections. */
export function arrivalGroupCount(sections: readonly (readonly ArrivalGroup[])[]): number {
  return sections.reduce((n, s) => n + s.length, 0)
}

const soonest = (g: ArrivalGroup) => g.times[0] ?? Infinity

/**
 * The sections cut to the `limit` groups due soonest (by their first time; a tie keeps list order), each kept in its
 * section and place; sections left empty are dropped. The group keyed `keep` (the focused row) is always kept, in
 * place of the latest of the others, so a poll never takes the focused row away. Unchanged when there are no more
 * than `limit` groups.
 */
export function soonestSections(
  sections: readonly (readonly ArrivalGroup[])[],
  limit: number,
  keep: string | null = null,
): ArrivalGroup[][] {
  const all = sections.flatMap((s, si) => s.map((g, gi) => ({ g, order: si * 1e6 + gi })))
  if (all.length <= limit) return sections.map((s) => [...s])
  const ranked = all.sort((a, b) => soonest(a.g) - soonest(b.g) || a.order - b.order).map((e) => e.g)
  const kept = ranked.slice(0, limit)
  const focused = keep === null ? undefined : ranked.find((g) => arrivalGroupKey(g) === keep)
  if (focused && limit > 0 && !kept.includes(focused)) kept[limit - 1] = focused
  const set = new Set(kept)
  return sections.map((s) => s.filter((g) => set.has(g))).filter((s) => s.length > 0)
}
