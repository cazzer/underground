import { searchTokens, type SearchToken } from './searchText.ts'
import { STREET_INDEX_FORMAT, type IndexSite, type StreetRow } from './streetIndexSchema.ts'

/** One crossing seen from one of its two streets. */
export interface Crossing {
  other: number
  site: IndexSite
  /** The street this list belongs to is the intersection's first (its label's first name). */
  ownerFirst: boolean
}

/** The index as the search reads it: the file's rows plus the lookups built once per isolate. */
export interface StreetIndex {
  streets: readonly StreetRow[]
  /** Street indices filed under a two-character key (`queryKey`). */
  byKey: ReadonlyMap<string, readonly number[]>
  /** Per street index, its crossings, in file order. */
  crossings: ReadonlyMap<number, readonly Crossing[]>
  /** The name's tokens, tokenized on first use. */
  tokens(street: number): readonly SearchToken[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Checks the committed file's outer shape and builds the lookups. Throws a fixed message when it is wrong, which fails the
 * Worker's startup loudly: a bad index must never ship quietly (the freshness test and the deploy validation catch it first).
 */
export function loadStreetIndex(raw: unknown): StreetIndex {
  if (!isRecord(raw) || raw.format !== STREET_INDEX_FORMAT) throw new TypeError('street index: wrong format')
  const { streets, intersections, keys } = raw
  if (!Array.isArray(streets) || !Array.isArray(intersections) || !Array.isArray(keys)) throw new TypeError('street index: missing arrays')
  const rows = streets as StreetRow[]
  const byKey = new Map<string, readonly number[]>()
  for (const [key, ids] of keys as [string, number[]][]) {
    if (ids.some((i) => !Number.isInteger(i) || i < 0 || i >= rows.length)) throw new TypeError('street index: a key names a missing street')
    byKey.set(key, ids)
  }
  const crossings = new Map<number, Crossing[]>()
  const add = (street: number, crossing: Crossing): void => {
    const list = crossings.get(street)
    if (list) list.push(crossing)
    else crossings.set(street, [crossing])
  }
  for (const [first, second, site] of intersections as [number, number, IndexSite][]) {
    const a = rows[first]
    const b = rows[second]
    if (a === undefined || b === undefined || first === second || a[1] !== b[1]) throw new TypeError('street index: a bad intersection')
    add(first, { other: second, site, ownerFirst: true })
    add(second, { other: first, site, ownerFirst: false })
  }
  const memo = new Array<readonly SearchToken[] | undefined>(rows.length)
  return {
    streets: rows,
    byKey,
    crossings,
    tokens: (street) => (memo[street] ??= searchTokens(rows[street]![0])),
  }
}
