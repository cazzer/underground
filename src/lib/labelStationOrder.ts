/** The order the street label pass takes the drawn stations in (o3r.6). Pure. */

/**
 * The focused station first (when it is drawn), then the stations already labelled in their earlier order, then the
 * newly drawn ones in `current`'s order (view order): a station joining never outranks one already labelled, so its
 * labels never push theirs out. Stations no longer drawn drop out. Returns `prev` itself when nothing changed.
 */
export function labelStationOrder(prev: readonly string[], current: readonly string[], focusedId: string | null): readonly string[] {
  const drawn = new Set(current)
  const next: string[] = []
  if (focusedId !== null && drawn.has(focusedId)) next.push(focusedId)
  for (const id of prev) if (id !== focusedId && drawn.has(id)) next.push(id)
  const kept = new Set(next)
  for (const id of current) if (!kept.has(id)) next.push(id)
  return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next
}
