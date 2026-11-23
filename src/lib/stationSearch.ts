/** Station search: tokenized, abbreviation-aware, typo-tolerant ranking. Pure. */
import { matchName, typedTokens } from '../../worker/src/nameMatch'
import { searchTokens, type SearchToken } from '../../worker/src/searchText'

export interface SearchableStation {
  id: string
  name: string
  routeIds: readonly string[]
  /** A complex's other member names (StationGroup.otherNames): matched too, a little below the name itself. */
  otherNames?: readonly string[]
}

interface Entry<S extends SearchableStation> {
  station: S
  /** The name's tokens. */
  tokens: readonly SearchToken[]
  /** The other member names' tokens. */
  aliases: readonly (readonly SearchToken[])[]
}

export interface SearchIndex<S extends SearchableStation> {
  entries: readonly Entry<S>[]
}

/** A match on another member's name scores this much below the same match on the station's own name, so a station's name beats an equal alias. */
export const ALIAS_PENALTY = 0.5

export const SEARCH_LIMIT = 20

export function buildSearchIndex<S extends SearchableStation>(stations: readonly S[]): SearchIndex<S> {
  return {
    entries: stations.map((station) => ({
      station,
      tokens: searchTokens(station.name),
      aliases: (station.otherNames ?? []).map(searchTokens),
    })),
  }
}

/**
 * Best matches first, at most `limit`. Ties: nearer `distanceOf` (given while a location fix is known: meters from it,
 * computed here once per match), then more routes, then name, then id. Empty for a blank query. Without `distanceOf`
 * the order is exactly the same as before it existed.
 */
export function searchStations<S extends SearchableStation>(
  index: SearchIndex<S>,
  query: string,
  limit = SEARCH_LIMIT,
  distanceOf?: (station: S) => number,
): S[] {
  const q = typedTokens(query)
  if (q.length === 0) return []
  const scored: { station: S; score: number; d: number }[] = []
  for (const entry of index.entries) {
    let score = matchName(q, entry.tokens).score
    for (const alias of entry.aliases) {
      const aliasScore = matchName(q, alias).score
      if (aliasScore > 0) score = Math.max(score, aliasScore - ALIAS_PENALTY)
    }
    if (score > 0) scored.push({ station: entry.station, score, d: distanceOf ? distanceOf(entry.station) : 0 })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.d - b.d ||
      b.station.routeIds.length - a.station.routeIds.length ||
      a.station.name.localeCompare(b.station.name) ||
      a.station.id.localeCompare(b.station.id),
  )
  return scored.slice(0, limit).map((s) => s.station)
}
