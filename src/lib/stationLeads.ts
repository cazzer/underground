/** A complex's lead, from stations.json `complexes`. Pure; `.ts` imports because the scripts load it too. */
import type { StationId } from '../data/schema.ts'

/** Member id to lead id (a lead maps to itself), validated: known ids, 2+ members, no id twice (throws, naming stations.json). */
export function stationLeads(
  complexes: readonly (readonly StationId[])[],
  known: ReadonlySet<StationId>,
): ReadonlyMap<StationId, StationId> {
  const leads = new Map<StationId, StationId>()
  for (const members of complexes) {
    if (members.length < 2) throw new Error(`stations.json complexes: ${JSON.stringify(members)} has fewer than 2 stations`)
    for (const id of members) {
      if (!known.has(id)) throw new Error(`stations.json complexes: ${id} is not a station`)
      if (leads.has(id)) throw new Error(`stations.json complexes: ${id} is in two complexes`)
      leads.set(id, members[0]!)
    }
  }
  return leads
}
