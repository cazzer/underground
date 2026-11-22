/** Which hash bucket a street or intersection search entry is filed in, and which one a query reads. Pure: the shard
 *  build (scripts/) and the search client share it, so the file a query fetches is the file the entry was written to.
 *  Loaded by a scripts/ test, so imports use explicit `.ts` paths.
 *
 *  Client contract (2q7.14): `k = queryBucketKey(q)`; fetch
 *  `data/search/streets/${bucketFileName(bucketOf(k, STREET_BUCKETS))}`; check the shard's `format` is SEARCH_FORMAT and its
 *  `buckets` is STREET_BUCKETS (on a mismatch log once and show no street results); keep only the entries whose
 *  `entryBucketKeys` contains `k`; rank them with the station search's token matching.
 *
 *  Guarantee: a query token of two or more characters that matches a DISTINCTIVE token of the name (exactly or as a
 *  prefix, spelled as published, by its canonical form, or by a long form) finds the entry in the one shard of the query's
 *  key. A query of generic tokens only finds names made only of generic tokens ("West St", "Court St"). Not covered: a typo
 *  in the first two characters; a one-character token, which finds only names with a one-character token; and prefixes typed
 *  before the name's first distinctive word ("sou" for South Portland Av, "av" for Av I), which may miss. */
import { longForms, searchTokens, type SearchToken } from './searchText.ts'

/** Bump when the key or bucket rule changes; a shard of another format is ignored. */
export const SEARCH_FORMAT = 1
export const STREET_BUCKETS = 64

/** Canonical tokens that name a kind of street or a compass side, not the street: they never pick the bucket, unless a
 *  name has nothing else ("West St", "Court St"). */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  'st', 'av', 'pl', 'rd', 'blvd', 'dr', 'ln', 'pkwy', 'sq', 'hwy', 'tpke', 'court', 'terrace', 'plaza', 'alley', 'way', 'walk', 'loop', 'e', 'w', 'n', 's',
])

/** 32-bit FNV-1a over the UTF-16 code units. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function bucketOf(key: string, buckets: number): number {
  return fnv1a32(key) % buckets
}

/** "00.json" to "ff.json". */
export function bucketFileName(bucket: number): string {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > 255) throw new Error(`bucket ${String(bucket)} is not an integer from 0 to 255`)
  return `${bucket.toString(16).padStart(2, '0')}.json`
}

/** The keys one name token is filed under: its first two characters as written and in canonical form, and those of the
 *  long forms that canonicalize to it ("mt" also under "mo" for "mount"). A one-character token keys as itself. */
function tokenKeys(t: SearchToken): string[] {
  return [t.raw.slice(0, 2), t.canon.slice(0, 2), ...longForms(t.canon).map((f) => f.slice(0, 2))]
}

/** Every key a name (or the two names of an intersection) is filed under, sorted and unique: those of the distinctive
 *  tokens, or of all tokens when none is distinctive. */
export function entryBucketKeys(names: readonly string[]): string[] {
  const keys = new Set<string>()
  for (const name of names) {
    const tokens = searchTokens(name)
    const distinctive = tokens.filter((t) => !GENERIC_TOKENS.has(t.canon))
    for (const t of distinctive.length > 0 ? distinctive : tokens) for (const k of tokenKeys(t)) keys.add(k)
  }
  return [...keys].sort()
}

/** The key a query reads: the first two characters of its first distinctive token (else its first). A trailing ordinal
 *  suffix being typed ("14t") is dropped first. Null when the query has no tokens. */
export function queryBucketKey(query: string): string | null {
  const tokens = searchTokens(query.replace(/(\d)[stnr]$/i, '$1'))
  const chosen = tokens.find((t) => !GENERIC_TOKENS.has(t.canon)) ?? tokens[0]
  return chosen === undefined ? null : chosen.raw.slice(0, 2)
}
