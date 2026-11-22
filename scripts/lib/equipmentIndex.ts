/** public/data/stations/equipment.json: every revenue elevator and escalator of the pinned E&E inventory, and the
 *  stations that list it (a complex's machines under every member). Pure; build-stations.ts is the IO.
 *  Licensing: MTA data under the OPEN-NY Terms of Use (no OSM content). */
import { EQUIPMENT_FORMAT, type EquipmentIndexFile, type EquipmentMachine } from '../../src/data/equipmentSchema.ts'
import type { CatalogEquipment, CatalogStation } from './catalogTypes.ts'

export const EQUIPMENT_ATTRIBUTION =
  'Metropolitan Transportation Authority. MTA Subway Elevator and Escalator Asset Inventory (data.ny.gov 94fv-bak7) and MTA Subway Stations (39hk-dx4f), under the OPEN-NY Terms of Use.'

/** The Worker's CODE_PATTERN (worker/src/ene.ts): a code the feed could never name is no use here. */
const CODE_PATTERN = /^[A-Z]{2}[A-Z0-9]{1,10}$/

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The inventory's description as one line of panel text: format, bidi and surrogate characters (and U+FEFF) removed
 * outright, whitespace collapsed, other control characters dropped, one trailing "." trimmed (the panel's other
 * lines have none), first letter capitalised. Never truncated (the panel clamps it). Null for none.
 */
export function cleanServing(text: string | null): string | null {
  if (text === null) return null
  const clean = text
    .replace(/[\p{Cf}\p{Cs}\uFEFF]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .trimEnd()
  return clean === '' ? null : clean.charAt(0).toUpperCase() + clean.slice(1)
}

export interface EquipmentIndexBuild {
  file: EquipmentIndexFile
  /** What was left out and why, one line each. */
  log: string[]
}

/**
 * Keeps each revenue machine that has a station. Its stations are the GTFS stops of that station's complex (read
 * from the station row, not the machine's own complex id) that `gtfsIds` (stations.json) knows. Throws for a machine
 * at a station the catalog lacks and for a repeated code; logs and skips a code the Worker would reject and a machine
 * whose stations the map doesn't have.
 */
export function buildEquipmentIndex(
  stations: readonly CatalogStation[],
  equipment: readonly CatalogEquipment[],
  rowsUpdatedAt: string,
  gtfsIds: ReadonlySet<string>,
): EquipmentIndexBuild {
  const log: string[] = []
  const complexOf = new Map<string, string>()
  const membersOfComplex = new Map<string, string[]>()
  for (const s of stations) {
    complexOf.set(s.stationId, s.complexId)
    if (!gtfsIds.has(s.gtfsStopId)) continue
    const members = membersOfComplex.get(s.complexId) ?? []
    members.push(s.gtfsStopId)
    membersOfComplex.set(s.complexId, members)
  }

  const machines = new Map<string, EquipmentMachine>()
  const listed = new Map<string, string[]>()
  const nonRevenue: string[] = []
  const noStation: string[] = []
  const seen = new Set<string>()
  for (const row of equipment) {
    // Every row, before any filter: a repeated code is a corrupt pin whatever else is wrong with the rows.
    if (seen.has(row.code)) throw new Error(`equipment ${row.code} appears twice`)
    seen.add(row.code)
    if (!row.revenue) {
      nonRevenue.push(row.code)
      continue
    }
    if (row.stationId === null) {
      noStation.push(row.code)
      continue
    }
    const complexId = complexOf.get(row.stationId)
    if (complexId === undefined) throw new Error(`equipment ${row.code}: station ${row.stationId} is not in the station catalog`)
    if (!CODE_PATTERN.test(row.code)) {
      log.push(`equipment ${row.code}: code the Worker's feed reader rejects, skipped`)
      continue
    }
    const members = membersOfComplex.get(complexId) ?? []
    if (members.length === 0) {
      log.push(`equipment ${row.code}: no station of its complex is in stations.json, skipped`)
      continue
    }
    machines.set(row.code, { kind: row.kind, serving: cleanServing(row.serving) })
    for (const member of members) listed.set(member, [...(listed.get(member) ?? []), row.code])
  }
  if (nonRevenue.length > 0) log.push(`${nonRevenue.length} non-revenue machine(s) left out`)
  if (noStation.length > 0) log.push(`${noStation.length} revenue machine(s) with no station left out: ${noStation.join(', ')}`)

  const file: EquipmentIndexFile = {
    format: EQUIPMENT_FORMAT,
    attribution: EQUIPMENT_ATTRIBUTION,
    rowsUpdatedAt,
    machines: Object.fromEntries([...machines].sort(([a], [b]) => byText(a, b))),
    stations: Object.fromEntries([...listed].map(([id, codes]) => [id, codes.sort(byText)] as const).sort(([a], [b]) => byText(a, b))),
  }
  return { file, log }
}
