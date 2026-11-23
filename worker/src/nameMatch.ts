/** Token matching of a typed query against a name: abbreviation-aware, typo-tolerant. Pure. The station search (client) and the
 *  street search (Worker) both rank with it. Loaded by scripts through the Worker's street code, so imports use `.ts` paths. */
import { longForms, osaDistance, searchTokens, type SearchToken } from './searchText.ts'

const EXACT = 3
const PREFIX = 2
const FUZZY = 1
/** Unmatched name words cost at most this much, so an exact word (3) always beats a prefix (2) by more. */
const MAX_UNMATCHED_PENALTY = 0.9

/** The query's tokens as typed: "14t" is a half-typed "14th", a bare number. */
export function typedTokens(text: string): SearchToken[] {
  return searchTokens(text.replace(/(\d)[stnr]$/i, '$1'))
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

export interface NameMatch {
  /** 0 when some query token matches nothing. */
  score: number
  /** Every word of the name was matched by a query token. */
  whole: boolean
}

/**
 * How well `query` matches `name`: every query token must match a name word (exact 3, prefix 2, fuzzy 1), with bonuses
 * for starting at the first word and for word order, less a small cost per unmatched name word. With `partialLast` false the
 * last query token is a finished word, not half typed (the side of an intersection before its separator).
 */
export function matchName(query: readonly SearchToken[], name: readonly SearchToken[], partialLast = true): NameMatch {
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
      const s = matchToken(q, name[ni]!, partialLast && qi === query.length - 1)
      if (s > best) {
        best = s
        bestIndex = ni
      }
    }
    if (best === 0) return { score: 0, whole: false }
    score += best
    used.add(bestIndex)
    if (qi === 0) firstAtStart = bestIndex === 0
    if (bestIndex <= prevIndex) increasing = false
    prevIndex = bestIndex
  }
  if (firstAtStart) score += 2
  if (increasing) score += 1
  return { score: score - Math.min(MAX_UNMATCHED_PENALTY, 0.5 * (name.length - used.size)), whole: used.size === name.length }
}
