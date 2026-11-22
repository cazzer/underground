/** The stations a trip end stands for. Pure. */
import type { StationId } from '../../data/schema'

/**
 * The chosen station and every station that shares its name and is linked to it by a transfer (directly or through
 * another same-named one): the members of a complex such as 14 St-Union Sq. Routing from or to all of them means a trip
 * never starts or ends with a walk to a station of the same name. The chosen one comes first, the rest by id.
 */
export function complexMembers(
  stations: readonly { id: StationId; name: string }[],
  id: StationId,
  transfers: readonly { from: StationId; to: StationId }[],
): StationId[] {
  const name = stations.find((s) => s.id === id)?.name
  if (name === undefined) return [id]
  const sameName = new Set(stations.filter((s) => s.name === name).map((s) => s.id))
  const linked = new Map<StationId, StationId[]>()
  for (const t of transfers) {
    if (!sameName.has(t.from) || !sameName.has(t.to) || t.from === t.to) continue
    linked.set(t.from, [...(linked.get(t.from) ?? []), t.to])
    linked.set(t.to, [...(linked.get(t.to) ?? []), t.from])
  }
  const seen = new Set<StationId>([id])
  const queue = [id]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const n of linked.get(next) ?? []) {
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  return [id, ...[...seen].filter((s) => s !== id).sort()]
}
