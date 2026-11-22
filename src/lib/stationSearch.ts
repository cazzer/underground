/** Station search: tokenized, abbreviation-aware, typo-tolerant ranking. Pure. */
import { longForms, osaDistance, searchTokens, type SearchToken } from './searchText'

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

const EXACT = 3
const PREFIX = 2
const FUZZY = 1
/** Unmatched name words cost at most this much, so an exact word (3) always beats a prefix (2) by more. */
const MAX_UNMATCHED_PENALTY = 0.9

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

function isFuzzy(q: SearchToken, n: SearchToken, last: boolean): boolean {
  if (q.numeric || n.numeric || q.raw.length < 4) return false
  const allowed = q.raw.length >= 8 ? 2 : 1
  if (osaDistance(q.raw, n.raw) <= allowed) return true
  // Abbreviations are one or two letters; fuzzy-comparing them matches anything.
  if (q.canon.length >= 4 && n.canon.length >= 4 && osaDistance(q.canon, n.canon) <= allowed) return true
  if (!last || q.raw.length < 5) return false
  // The last word may be half typed: compare against the start of the name word as well.
  for (const len of [q.raw.length - 1, q.raw.length, q.raw.length + 1]) {
    if (len > 0 && len < n.raw.length && osaDistance(q.raw, n.raw.slice(0, len)) <= allowed) return true
  }
  return false
}

function isPrefix(q: SearchToken, n: SearchToken, last: boolean): boolean {
  // A number only starts a longer number as the last word, and not when written "14th".
  if (q.numeric) return last && !q.ordinal && n.numeric && n.raw.startsWith(q.raw)
  if (n.raw.startsWith(q.raw)) return true
  // "west" means W, not everything starting with w: abbreviations match by canon only when typed as such.
  if (q.raw === q.canon && n.canon.startsWith(q.canon)) return true
  // A half-typed long form ("stre", "squa") of the abbreviation the name uses.
  return last && longForms(n.canon).some((form) => form.startsWith(q.raw))
}

/** 3 exact, 2 prefix, 1 fuzzy, 0 none. */
function matchToken(q: SearchToken, n: SearchToken, last: boolean): number {
  if (n.canon === q.canon || n.raw === q.raw) return EXACT
  if (isPrefix(q, n, last)) return PREFIX
  return isFuzzy(q, n, last) ? FUZZY : 0
}

function scoreEntry(query: readonly SearchToken[], name: readonly SearchToken[]): number {
  let score = 0
  let increasing = true
  let prevIndex = -1
  let firstAtStart = false
  const used = new Set<number>()
  for (let qi = 0; qi < query.length; qi++) {
    const q = query[qi]!
    let best = 0
    let bestIndex = -1
    for (let ni = 0; ni < name.length; ni++) {
      const s = matchToken(q, name[ni]!, qi === query.length - 1)
      if (s > best) {
        best = s
        bestIndex = ni
      }
    }
    if (best === 0) return 0
    score += best
    used.add(bestIndex)
    if (qi === 0) firstAtStart = bestIndex === 0
    if (bestIndex <= prevIndex) increasing = false
    prevIndex = bestIndex
  }
  if (firstAtStart) score += 2
  if (increasing) score += 1
  return score - Math.min(MAX_UNMATCHED_PENALTY, 0.5 * (name.length - used.size))
}

/** Best matches first, at most `limit`. Ties: more routes, then name, then id. Empty for a blank query. */
export function searchStations<S extends SearchableStation>(index: SearchIndex<S>, query: string, limit = SEARCH_LIMIT): S[] {
  // "14t" is a half-typed "14th": a bare number.
  const q = searchTokens(query.replace(/(\d)[stnr]$/i, '$1'))
  if (q.length === 0) return []
  const scored: { station: S; score: number }[] = []
  for (const entry of index.entries) {
    let score = scoreEntry(q, entry.tokens)
    for (const alias of entry.aliases) {
      const aliasScore = scoreEntry(q, alias)
      if (aliasScore > 0) score = Math.max(score, aliasScore - ALIAS_PENALTY)
    }
    if (score > 0) scored.push({ station: entry.station, score })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.station.routeIds.length - a.station.routeIds.length ||
      a.station.name.localeCompare(b.station.name) ||
      a.station.id.localeCompare(b.station.id),
  )
  return scored.slice(0, limit).map((s) => s.station)
}
