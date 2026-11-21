/** Joins borough and ADA status from the pinned 39hk-dx4f catalog onto the GTFS stations. Pure. */
import type { AdaStatus, Borough, PartialAccess, Station } from '../../src/data/schema.ts'
import type { GtfsStation } from './network.ts'
import type { CatalogStation } from './catalogTypes.ts'

const BOROUGHS: ReadonlySet<string> = new Set<Borough>(['Bx', 'M', 'Bk', 'Q', 'SI'])
const ADA: readonly AdaStatus[] = ['none', 'full', 'partial']

interface Access {
  borough: Borough
  ada: AdaStatus
  adaPartial?: PartialAccess
}

/** The access fields of one row, or the problems with it (never both). */
function encode(row: CatalogStation): Access | string[] {
  const id = row.gtfsStopId
  const problems: string[] = []
  if (!BOROUGHS.has(row.borough)) problems.push(`${id}: unknown borough ${JSON.stringify(row.borough)}`)
  const ada = ADA[row.ada]
  if (ada === undefined) {
    problems.push(`${id}: ada ${JSON.stringify(row.ada)} is not 0, 1 or 2`)
    return problems
  }
  const note = row.adaNotes?.trim() ?? ''
  const flags = Number(row.adaNorth) + Number(row.adaSouth)
  if (ada === 'none' && (flags !== 0 || note !== '')) problems.push(`${id}: ada 0 with a direction flag or note`)
  if (ada === 'full' && (flags !== 2 || note !== '')) problems.push(`${id}: ada 1 needs both directions and no note`)
  if (ada === 'partial' && (flags !== 1 || note === '')) problems.push(`${id}: ada 2 needs exactly one direction and a note`)
  if (problems.length > 0) return problems
  const access: Access = { borough: row.borough as Borough, ada }
  if (ada === 'partial') access.adaPartial = { north: row.adaNorth, south: row.adaSouth, note }
  return access
}

/** Adds `borough`, `ada` and (partial only) `adaPartial` after `routes`, keeping the input order.
 *  Throws once, listing every id that has no match or a row that doesn't make sense. */
export function addAccess(stations: GtfsStation[], rows: readonly CatalogStation[]): Station[] {
  const byId = new Map(rows.map((r) => [r.gtfsStopId, r]))
  const known = new Set(stations.map((s) => s.id))
  const problems: string[] = []
  const missing = stations.filter((s) => !byId.has(s.id)).map((s) => s.id)
  if (missing.length > 0) {
    problems.push(`GTFS stations with no catalog row: ${missing.join(', ')} (run npm run data:catalog:fetch)`)
  }
  const orphans = rows.filter((r) => !known.has(r.gtfsStopId)).map((r) => r.gtfsStopId)
  if (orphans.length > 0) problems.push(`catalog rows with no GTFS station: ${orphans.join(', ')}`)

  const out: Station[] = []
  for (const station of stations) {
    const row = byId.get(station.id)
    if (row === undefined) continue
    const access = encode(row)
    if (Array.isArray(access)) problems.push(...access)
    else out.push({ ...station, ...access })
  }
  if (problems.length > 0) throw new Error(`Station access data does not match the feed:\n  ${problems.join('\n  ')}`)
  return out
}
