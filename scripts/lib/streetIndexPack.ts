/** Packs the street and intersection entries into the one index file the Worker bundles (2q7.14). Pure. The contract and
 *  the rules kept are in worker/src/streetIndexSchema.ts; the key rule is worker/src/streetKeys.ts. */
import { entryKeys } from '../../worker/src/streetKeys.ts'
import {
  STREET_INDEX_FORMAT,
  type CrossingRow,
  type IndexSite,
  type KeyRow,
  type StreetIndexFile,
  type StreetRow,
} from '../../worker/src/streetIndexSchema.ts'
import type { SearchSite, StreetSearchEntry } from './streetIndexTypes.ts'

export const STREET_ATTRIBUTION = '© OpenStreetMap contributors'

const dropStation = (s: SearchSite): IndexSite => [s[0], s[1]]

/** The entries (streets then intersections, in the order the builder sorted them) as the Worker's index. Throws on a display
 *  name with ", " in it (the label is "<name>, <borough>") or an intersection naming a street that has no row. */
export function packStreetIndex(entries: readonly StreetSearchEntry[], osmTimestamp: string): StreetIndexFile {
  const streets: StreetRow[] = []
  const indexOf = new Map<string, number>()
  const byKey = new Map<string, number[]>()
  for (const e of entries) {
    if (e.kind !== 'street') continue
    if (e.name.includes(', ')) throw new Error(`street name "${e.name}" contains ", ", which the result label cannot carry`)
    const sites: IndexSite[] = []
    for (const s of e.sites.map(dropStation)) if (!sites.some((t) => t[0] === s[0] && t[1] === s[1])) sites.push(s)
    const at = streets.length
    indexOf.set(`${e.borough}\t${e.name}`, at)
    streets.push([e.name, e.borough, e.rank, sites])
    for (const k of entryKeys([e.name])) byKey.set(k, [...(byKey.get(k) ?? []), at])
  }
  const intersections: CrossingRow[] = []
  for (const e of entries) {
    if (e.kind !== 'intersection') continue
    const [a, b] = e.names.map((n) => indexOf.get(`${e.borough}\t${n}`))
    if (a === undefined || b === undefined) throw new Error(`intersection ${e.names.join(' & ')} in ${e.borough} names a street with no row`)
    intersections.push([a, b, dropStation(e.site)])
  }
  const keys: KeyRow[] = [...byKey].sort((x, y) => (x[0] < y[0] ? -1 : 1))
  return { format: STREET_INDEX_FORMAT, license: 'ODbL-1.0', attribution: STREET_ATTRIBUTION, osmTimestamp, streets, intersections, keys }
}
