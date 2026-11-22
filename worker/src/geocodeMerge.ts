import type { Candidate } from './geocodeCandidate'
import { isAddressLike } from './geocodeQuery'
import { GEOCODE_MAX_RESULTS, type GeocodeResult } from './schema'

/** PAD aliases of one building share its point. */
const SAME_POINT_M = 2
/** A cross-source twin, or Photon's duplicate nodes, sit this close. */
const TWIN_M = 150

/** Equirectangular distance in meters; fine at city scale. */
export function distanceM(a: GeocodeResult, b: GeocodeResult): number {
  const dy = (b.lat - a.lat) * 110_540
  const dx = (b.lon - a.lon) * 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

function areDuplicates(a: Candidate, b: Candidate): boolean {
  const d = distanceM(a.result, b.result)
  if (a.result.source === 'geosearch' && b.result.source === 'geosearch' && d <= SAME_POINT_M) return true
  // Two branches of a chain share a name and sit close, but each has its own address.
  if (a.address !== null && b.address !== null && a.address !== b.address) return false
  return a.key === b.key && d <= TWIN_M
}

/** How many query tokens the candidate's name has; the last may be half typed. */
function matchCount(c: Candidate, tokens: string[]): number {
  const words = c.key.split(' ')
  let n = 0
  tokens.forEach((t, i) => {
    const last = i === tokens.length - 1
    if (words.some((w) => w === t || (last && w.startsWith(t)))) n++
  })
  return n
}

interface Ranked {
  candidate: Candidate
  rank: number
  matches: number
}

const better = (a: Ranked, b: Ranked): boolean =>
  a.matches !== b.matches
    ? a.matches > b.matches
    : a.candidate.name.length !== b.candidate.name.length
      ? a.candidate.name.length < b.candidate.name.length
      : a.rank < b.rank

/**
 * Concatenates the lists (their order is the rank), folds duplicates into one row each (the member that
 * matches the most query tokens, then the shortest name, then the best rank), and keeps `limit`.
 */
export function mergeCandidates(
  lists: Candidate[][],
  tokens: string[],
  limit: number = GEOCODE_MAX_RESULTS,
): GeocodeResult[] {
  const all = lists.flat().map((candidate, rank): Ranked => ({ candidate, rank, matches: matchCount(candidate, tokens) }))
  const groups: Ranked[][] = []
  for (const item of all) {
    const home = groups.find((g) => g.some((m) => areDuplicates(m.candidate, item.candidate)))
    if (home) home.push(item)
    else groups.push([item])
  }
  return groups
    .map((g) => ({ best: g.reduce((a, b) => (better(b, a) ? b : a)), rank: Math.min(...g.map((m) => m.rank)) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((g) => g.best.candidate.result)
}

/** A hit of the kind the query asks for: a place or area, or an address for a house-number query. */
export function hasSatisfyingHit(candidates: Candidate[], text: string): boolean {
  const wantsAddress = isAddressLike(text)
  return candidates.some(({ result }) => result.kind === 'place' || result.kind === 'area' || (wantsAddress && result.kind === 'address'))
}
