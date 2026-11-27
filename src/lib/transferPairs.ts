/**
 * The station pairs a trip can walk between (85r). Pure. A transfers.json link joins two stations; one between two
 * members of a complex is a change inside one station as the UI shows it and draws nothing, so only the links between
 * different complexes are walks the map draws along the street network.
 *
 * The set is fixed by the static data alone (never by a journey), so loading its walk shards reveals nothing about
 * the trip: see "Walk shards" in AGENTS.md.
 */
import type { StationId, Transfer } from '../data/schema'

/** `leadOf` gives a station's complex lead (the station itself when it is in none). */
export function transferPairStations(
  transfers: readonly Pick<Transfer, 'from' | 'to'>[],
  leadOf: (id: StationId) => StationId,
): [StationId, StationId][] {
  const seen = new Set<string>()
  const pairs: [StationId, StationId][] = []
  for (const { from, to } of transfers) {
    if (from === to || leadOf(from) === leadOf(to)) continue
    const [a, b] = from < to ? [from, to] : [to, from]
    const key = `${a}>${b}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push([a, b])
  }
  return pairs
}

/** Every station of every pair, sorted: the shards to load. */
export function transferStationIds(pairs: readonly (readonly [StationId, StationId])[]): StationId[] {
  return [...new Set(pairs.flat())].sort()
}
