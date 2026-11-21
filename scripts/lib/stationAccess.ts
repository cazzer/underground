/** Joins borough and ADA status from the pinned 39hk-dx4f catalog onto the GTFS stations. Pure. */
import type { AdaStatus, Borough, Station, StationAccess } from '../../src/data/schema.ts'
import type { GtfsStation } from './network.ts'
import type { CatalogStation } from './catalogTypes.ts'
import type { AccessExceptions } from './accessExceptions.ts'

const BOROUGHS: readonly string[] = ['Bx', 'M', 'Bk', 'Q', 'SI'] satisfies Borough[]
const ADA: readonly AdaStatus[] = ['none', 'full', 'partial']

function isBorough(x: string): x is Borough {
  return BOROUGHS.includes(x)
}

/** The access fields for one station, or the problems with it (never both). `north`/`south` are
 *  the directions the source marks accessible; `note` is its free text. */
function encode(id: string, borough: string, ada: AdaStatus, north: boolean, south: boolean, noteRaw: string | null): StationAccess | string[] {
  const problems: string[] = []
  if (!isBorough(borough)) problems.push(`${id}: unknown borough ${JSON.stringify(borough)}`)
  const note = noteRaw?.trim() ?? ''
  const flags = Number(north) + Number(south)
  if (ada === 'none' && (flags !== 0 || note !== '')) problems.push(`${id}: ada 0 with a direction flag or note`)
  if (ada === 'full' && (flags !== 2 || note !== '')) problems.push(`${id}: ada 1 needs both directions and no note`)
  if (ada === 'partial' && (flags !== 1 || note === '')) problems.push(`${id}: ada 2 needs exactly one direction and a note`)
  if (problems.length > 0 || !isBorough(borough)) return problems
  const access: StationAccess = { borough, ada }
  if (ada === 'partial') access.adaPartial = { north, south, note }
  return access
}

function encodeRow(row: CatalogStation): StationAccess | string[] {
  const ada = ADA[row.ada]
  if (ada === undefined) return [`${row.gtfsStopId}: ada ${JSON.stringify(row.ada)} is not 0, 1 or 2`]
  return encode(row.gtfsStopId, row.borough, ada, row.adaNorth, row.adaSouth, row.adaNotes)
}

/** An authored entry; `ada: 'full'` and `'none'` imply the flags, `'partial'` takes them from `adaPartial`. */
function encodeException(id: string, e: AccessExceptions['missing'][string]): StationAccess | string[] {
  const ada = ADA.find((a) => a === e.ada)
  if (ada === undefined) return [`${id}: exception ada ${JSON.stringify(e.ada)} is not none, full or partial`]
  if (ada !== 'partial') {
    if (e.adaPartial !== undefined) return [`${id}: exception has adaPartial but ada is ${ada}`]
    return encode(id, e.borough, ada, ada === 'full', ada === 'full', null)
  }
  if (e.adaPartial === undefined) return [`${id}: exception ada partial needs adaPartial`]
  return encode(id, e.borough, ada, e.adaPartial.north, e.adaPartial.south, e.adaPartial.note)
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id)
  return [...dupes]
}

export interface AccessResult {
  stations: Station[]
  /** Stale exceptions caused by a GTFS change (an orphan that is a station now, a missing entry for
   *  a station the feed dropped). The unattended `npm run data` prints these; `npm run data:access`
   *  and the staleness test fail on them. */
  warnings: string[]
}

/** Adds `borough`, `ada` and (partial only) `adaPartial` after `routes`, keeping the input order.
 *  A GTFS station with no catalog row takes its authored `exceptions.missing` entry; a catalog row
 *  with no GTFS station is ignored when listed in `exceptions.orphans`. An exception that is no
 *  longer needed is removed by hand: one made stale by the catalog throws, one made stale by a GTFS
 *  change is a warning. Throws once, listing every problem. */
export function addAccess(stations: GtfsStation[], rows: readonly CatalogStation[], exceptions: AccessExceptions): AccessResult {
  const problems: string[] = []
  const warnings: string[] = []
  const hasMissing = (id: string): boolean => Object.hasOwn(exceptions.missing, id)
  const hasOrphan = (id: string): boolean => Object.hasOwn(exceptions.orphans, id)
  const dupes = duplicates(rows.map((r) => r.gtfsStopId))
  if (dupes.length > 0) problems.push(`catalog has more than one row for: ${dupes.join(', ')}`)
  const byId = new Map(rows.map((r) => [r.gtfsStopId, r]))
  const known = new Set(stations.map((s) => s.id))

  const missing = stations.filter((s) => !byId.has(s.id) && !hasMissing(s.id)).map((s) => s.id)
  if (missing.length > 0) {
    problems.push(
      `GTFS stations with no catalog row: ${missing.join(', ')} (run npm run data:catalog:fetch; ` +
        `if 39hk-dx4f doesn't list it yet, add it to data/stations/access-exceptions.json)`,
    )
  }
  const orphans = rows.filter((r) => !known.has(r.gtfsStopId) && !hasOrphan(r.gtfsStopId)).map((r) => r.gtfsStopId)
  if (orphans.length > 0) {
    problems.push(`catalog rows with no GTFS station: ${orphans.join(', ')} (if they are expected, list them under "orphans" in data/stations/access-exceptions.json)`)
  }
  for (const id of Object.keys(exceptions.missing)) {
    if (!known.has(id)) warnings.push(`access-exceptions.json "missing" ${id}: not a GTFS station, remove it`)
    else if (byId.has(id)) problems.push(`access-exceptions.json "missing" ${id}: the catalog has a row now, remove it`)
  }
  for (const id of Object.keys(exceptions.orphans)) {
    if (known.has(id)) warnings.push(`access-exceptions.json "orphans" ${id}: it is a GTFS station now, remove it`)
    else if (!byId.has(id)) problems.push(`access-exceptions.json "orphans" ${id}: the catalog has no such row, remove it`)
  }

  const out: Station[] = []
  for (const station of stations) {
    const row = byId.get(station.id)
    const exception = hasMissing(station.id) ? exceptions.missing[station.id] : undefined
    const access = row !== undefined ? encodeRow(row) : exception !== undefined ? encodeException(station.id, exception) : null
    if (access === null) continue
    if (Array.isArray(access)) problems.push(...access)
    else out.push({ ...station, ...access })
  }
  if (problems.length > 0) throw new Error(`Station access data does not match the feed:\n  ${problems.join('\n  ')}`)
  return { stations: out, warnings }
}
