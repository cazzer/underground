/** The stations a trip end stands for. Pure. */
import type { StationId } from '../../data/schema'

/**
 * The chosen station and every other member of its complex (stations.json `complexes`, the catalog's complex_id): a
 * trip from or to Times Sq also starts or ends at the A/C/E platforms, so it never begins or ends with a walk to
 * another member. The chosen one comes first, the rest by id; a station in no complex stands alone.
 */
export function complexMembers(complexes: readonly (readonly StationId[])[], id: StationId): StationId[] {
  const group = complexes.find((members) => members.includes(id))
  if (group === undefined) return [id]
  return [id, ...group.filter((m) => m !== id).sort()]
}
