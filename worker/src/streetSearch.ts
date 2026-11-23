import type { Candidate } from './geocodeCandidate'
import type { GeocodeQuery } from './geocodeQuery'
import { nameKey } from './geocodeText'
import { matchName, typedTokens } from './nameMatch.ts'
import type { GeocodeKind } from './schema'
import type { StreetIndex } from './streetIndex'
import { BOROUGH_NAMES } from './streetIndexSchema.ts'
import { queryKey } from './streetKeys.ts'
import { distanceM } from './geocodeMerge'
import { siteFor, splitCrossing, withoutTrailingSeparator } from './streetQuery'

/** At most this many rows of each list (whole, partial), intersections and streets together, leave the search; the merge keeps fewer. */
const LIST_MAX = 8

interface Hit {
  street: number
  score: number
  whole: boolean
}

interface Ranked {
  candidate: Candidate
  score: number
  whole: boolean
  /** Meters from the focus to the row's point; 0 with no focus. */
  distanceM: number
  /** The row's street class (an intersection's is the lower of its two). */
  rank: number
  label: string
}

/** The streets one side of the query matches, among those filed under its key. */
function sideHits(index: StreetIndex, text: string, partialLast: boolean): Hit[] {
  const tokens = typedTokens(text)
  const key = queryKey(text)
  if (tokens.length === 0 || key === null) return []
  const hits: Hit[] = []
  for (const street of index.byKey.get(key) ?? []) {
    const m = matchName(tokens, index.tokens(street), partialLast)
    if (m.score > 0) hits.push({ street, score: m.score, whole: m.whole })
  }
  return hits
}

function ranked(
  kind: Extract<GeocodeKind, 'street' | 'intersection'>,
  name: string,
  borough: string,
  site: readonly [number, number],
  m: { score: number; whole: boolean; rank: number },
  focus: GeocodeQuery['focus'],
): Ranked {
  const label = `${name}, ${borough}`
  return {
    candidate: { result: { label, kind, lat: site[0], lon: site[1], source: 'osm' }, name, key: nameKey(name), address: null },
    score: m.score,
    whole: m.whole,
    distanceM: focus === null ? 0 : distanceM(focus, { lat: site[0], lon: site[1] }),
    rank: m.rank,
    label,
  }
}

function streetRows(index: StreetIndex, text: string, focus: GeocodeQuery['focus']): Ranked[] {
  return sideHits(index, text, true).map((hit) => {
    const [name, borough, rank, sites] = index.streets[hit.street]!
    return ranked('street', name, BOROUGH_NAMES[borough], siteFor(sites, focus), { ...hit, rank }, focus)
  })
}

/** Intersections of a street the left side matches (a finished word) with one the right side matches (maybe half typed). */
function intersectionRows(index: StreetIndex, [left, right]: [string, string], focus: GeocodeQuery['focus']): Ranked[] {
  const rights = new Map(sideHits(index, right, true).map((h) => [h.street, h]))
  if (rights.size === 0) return []
  // One row per label: two crossings of one pair keep the one nearer the focus (else the first in the file).
  const byLabel = new Map<string, Ranked>()
  for (const l of sideHits(index, left, false)) {
    const [leftName, borough, leftRank] = index.streets[l.street]!
    for (const c of index.crossings.get(l.street) ?? []) {
      const r = rights.get(c.other)
      if (r === undefined) continue
      const [rightName, , rightRank] = index.streets[c.other]!
      const name = c.ownerFirst ? `${leftName} & ${rightName}` : `${rightName} & ${leftName}`
      const row = ranked(
        'intersection',
        name,
        BOROUGH_NAMES[borough],
        c.site,
        { score: l.score + r.score, whole: l.whole && r.whole, rank: Math.min(leftRank, rightRank) },
        focus,
      )
      const twin = byLabel.get(row.label)
      if (twin === undefined || row.distanceM < twin.distanceM) byLabel.set(row.label, row)
    }
  }
  return [...byLabel.values()]
}

/** Better score, then nearer the focus, then the higher street class, then the label in code-unit order. */
function compare(a: Ranked, b: Ranked): number {
  return b.score - a.score || a.distanceM - b.distanceM || b.rank - a.rank || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
}

/**
 * The street and intersection rows for a query, as candidates: those whose name the query spells out whole ("bedford av"),
 * and those that have more words (a half-typed name). A separator with nothing after it yet ("bedford av &") is ignored. A query with a separator ("bedford av & n 7", "a and b", "a at b")
 * looks for intersections first, then, on the whole text, for streets, so a street whose own name holds the separator still
 * comes up. Each list is ranked and cut to LIST_MAX.
 */
export function searchStreets(index: StreetIndex, query: GeocodeQuery): { whole: Candidate[]; partial: Candidate[] } {
  const text = withoutTrailingSeparator(query.text)
  const split = splitCrossing(text)
  const lists = [
    split === null ? [] : intersectionRows(index, split, query.focus),
    streetRows(index, text, query.focus),
  ].map((rows) => rows.sort(compare))
  const pick = (whole: boolean): Candidate[] =>
    lists.flatMap((rows) => rows.filter((r) => r.whole === whole)).slice(0, LIST_MAX).map((r) => r.candidate)
  return { whole: pick(true), partial: pick(false) }
}
