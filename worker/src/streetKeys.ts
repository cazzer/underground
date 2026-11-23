/** The key rule of the street index: which two-character keys a street or intersection is filed under, and which one a
 *  query reads. Pure: the build (scripts/) writes the index's `keys` with it and the Worker's query reads with it, so the
 *  rows a query looks at are the rows it was filed under. Loaded by scripts, so imports use explicit `.ts` paths.
 *
 *  Guarantee: a query token of two or more characters that matches a DISTINCTIVE token of the name (exactly or as a
 *  prefix, spelled as published, by its canonical form, or by a long form) finds the entry under the query's one key. A
 *  query of generic tokens only finds names made only of generic tokens ("West St", "Court St"). Not covered: a typo
 *  in the first two characters; a one-character token, which finds only names with a one-character token; and prefixes typed
 *  before the name's first distinctive word ("sou" for South Portland Av, "av" for Av I), which may miss. */
import { longForms, searchTokens, type SearchToken } from './searchText.ts'

/** Canonical tokens that name a kind of street or a compass side, not the street: they never pick the key, unless a
 *  name has nothing else ("West St", "Court St"). */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  'st', 'av', 'pl', 'rd', 'blvd', 'dr', 'ln', 'pkwy', 'sq', 'hwy', 'tpke', 'court', 'terrace', 'plaza', 'alley', 'way', 'walk', 'loop', 'e', 'w', 'n', 's',
])

/** The keys one name token is filed under: its first two characters as written and in canonical form, and those of the
 *  long forms that canonicalize to it ("mt" also under "mo" for "mount"). A one-character token keys as itself. */
function tokenKeys(t: SearchToken): string[] {
  return [t.raw.slice(0, 2), t.canon.slice(0, 2), ...longForms(t.canon).map((f) => f.slice(0, 2))]
}

/** Every key a name (or the two names of an intersection) is filed under, sorted and unique: those of the distinctive
 *  tokens, or of all tokens when none is distinctive. */
export function entryKeys(names: readonly string[]): string[] {
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
export function queryKey(query: string): string | null {
  const tokens = searchTokens(query.replace(/(\d)[stnr]$/i, '$1'))
  const chosen = tokens.find((t) => !GENERIC_TOKENS.has(t.canon)) ?? tokens[0]
  return chosen === undefined ? null : chosen.raw.slice(0, 2)
}
