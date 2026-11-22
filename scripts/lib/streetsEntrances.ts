/** The entrances of one station's street file: the catalog rows that list the station, projected onto the file's
 *  decimeter grid, each joined to the street it opens onto (entranceStreet.ts), plus the log lines that tell a
 *  person where the join is doubtful. Pure. */
import type { StationId } from '../../src/data/schema.ts'
import type { StreetEntrance, StreetWay } from '../../src/data/streetSchema.ts'
import type { LatLon } from '../../src/lib/projection.ts'
import { toGround } from '../../src/lib/projection.ts'
import { isClosedRing } from '../../src/lib/streetClass.ts'
import { bool, finite, list, record, text } from './check.ts'
import { CORNER_MIN_ANGLE_DEG, JOIN_RADIUS_M, MEDIAN_MAX_M, joinEntrance, streetKey, type JoinWay } from './entranceStreet.ts'
import { nearestOnPolyline, SIDE_MIN_M } from './streetGeometry.ts'
import { RADIUS_M } from './streetsOsm.ts'

/** An entrance whose opposite same-street carriageway lies up to this far beyond MEDIAN_MAX_M (and within the join
 *  radius) is logged as a near miss, to tune MEDIAN_MAX_M on Eastern and Ocean Pkwy. */
export const NEAR_MISS_SLACK_M = JOIN_RADIUS_M - MEDIAN_MAX_M
/** An entrance this close to the pin's radius edge may have streets cut off beyond it. */
export const EDGE_MARGIN_M = 40
/** A shared complex entrance farther than this from the member's point is dropped (the far-entrance log's threshold). */
export const SHARED_MAX_M = RADIUS_M - EDGE_MARGIN_M
const ELEVATOR = 'Elevator'

export type LogKind = 'no-street' | 'near-miss' | 'bridge-tunnel' | 'far-entrance' | 'no-entrances' | 'shared-dropped' | 'no-ways' | 'whole-way' | 'oneway'

export interface BuildLog {
  kind: LogKind
  line: string
  /** Near misses: how far the second carriageway is, meters. */
  gapM?: number
}

/** One row of data/stations/catalog/entrances.json. */
export interface EntranceInput {
  type: string
  entry: boolean
  exit: boolean
  lat: number
  lon: number
  gtfsStopIds: string[]
}

/** The street file's geometry the entrances are joined against, as the file stores it. */
export interface FileStreets {
  ways: readonly StreetWay[]
  /** Decimeters, parallel to the file's node table. */
  x: readonly number[]
  z: readonly number[]
  /** The raw pinned tags of each way, for the bridge and tunnel log. */
  tags: ReadonlyMap<number, Readonly<Record<string, string>>>
}

export function parseEntranceRows(json: unknown): EntranceInput[] {
  const rows = list(record(json, 'entrances.json').rows, 'entrances.json.rows')
  return rows.map((raw, i) => {
    const at = `entrances.json.rows[${i}]`
    const row = record(raw, at)
    return {
      type: text(row.type, `${at}.type`),
      entry: bool(row.entry, `${at}.entry`),
      exit: bool(row.exit, `${at}.exit`),
      lat: finite(row.lat, `${at}.lat`),
      lon: finite(row.lon, `${at}.lon`),
      gtfsStopIds: list(row.gtfsStopIds, `${at}.gtfsStopIds`).map((s, j) => text(s, `${at}.gtfsStopIds[${j}]`)),
    }
  })
}

/** The catalog's complex of each stop: `gtfsStopId` to `complexId` over data/stations/catalog/stations.json (the
 *  catalog's own membership; stations.json carries none). */
export function parseComplexOf(json: unknown): Map<StationId, string> {
  const rows = list(record(json, 'catalog/stations.json').rows, 'catalog/stations.json.rows')
  const out = new Map<StationId, string>()
  rows.forEach((raw, i) => {
    const at = `catalog/stations.json.rows[${i}]`
    const row = record(raw, at)
    const id = text(row.gtfsStopId, `${at}.gtfsStopId`)
    if (out.has(id)) throw new Error(`${at}.gtfsStopId: "${id}" is listed twice`)
    out.set(id, text(row.complexId, `${at}.complexId`))
  })
  return out
}

/** Rows grouped by every station id they list, so a two-stop row reaches both stations. With `complexOf`, every
 *  station of a complex also gets every row that lists any of its members: a complex's entrances are one set, and
 *  each member's file draws all of them (positions are relative to that member's own anchor, in `buildEntrances`).
 *  A row's own `complexId` is not used: a few rows carry another complex's id (R20's four stairs say 607), while
 *  the stop ids they list are right. A station `complexOf` lacks keeps only the rows that list it. */
export function entrancesByStation(rows: readonly EntranceInput[], complexOf?: ReadonlyMap<StationId, string>): Map<StationId, EntranceInput[]> {
  const out = new Map<StationId, EntranceInput[]>()
  const add = (id: StationId, row: EntranceInput): void => {
    const have = out.get(id)
    if (have === undefined) out.set(id, [row])
    else if (!have.includes(row)) have.push(row)
  }
  const members = new Map<string, StationId[]>()
  for (const [id, complex] of complexOf ?? []) members.set(complex, [...(members.get(complex) ?? []), id])
  for (const row of rows) {
    for (const id of new Set(row.gtfsStopIds)) {
      add(id, row)
      const complex = complexOf?.get(id)
      if (complex !== undefined) for (const member of members.get(complex)!) add(member, row)
    }
  }
  return out
}

const COS_PARALLEL = Math.cos((CORNER_MIN_ANGLE_DEG * Math.PI) / 180)
const metersAt = (x: number, z: number): string => `(${(x / 10).toFixed(1)}, ${(z / 10).toFixed(1)}) m`

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of no values')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** The ways an entrance may join: all of the file's, except building passages (`tunnel=building_passage`, a way
 *  through a building, not a street). They stay in the file, drawn like any other way. */
function toJoinWays(file: FileStreets): JoinWay[] {
  return file.ways.filter((w) => file.tags.get(w.id)?.tunnel !== 'building_passage').map((w) => ({
    id: w.id,
    highway: w.highway,
    name: w.name,
    closed: isClosedRing(w.nodes),
    points: w.nodes.map((n): [number, number] => [file.x[n]! / 10, file.z[n]! / 10]),
  }))
}

/** The same street's other carriageway just beyond the median reach, on the other side and running alongside:
 *  the distance to it, or null. */
function nearMissGapM(p: [number, number], wayId: number, ways: readonly JoinWay[]): number | null {
  const own = ways.find((w) => w.id === wayId)!
  const ownNear = nearestOnPolyline(p, own.points)
  if (ownNear === null || ownNear.side === null) return null
  const key = streetKey(own.name!)
  let gap: number | null = null
  for (const way of ways) {
    if (way.id === wayId || way.name === null || way.closed) continue
    const near = nearestOnPolyline(p, way.points)
    if (near === null || near.dist <= MEDIAN_MAX_M || near.dist > MEDIAN_MAX_M + NEAR_MISS_SLACK_M) continue
    if (near.side === null || near.pastEnd > SIDE_MIN_M) continue
    if (Math.abs(near.tx * ownNear.tx + near.tz * ownNear.tz) < COS_PARALLEL) continue
    if (near.side[0] * ownNear.side[0] + near.side[1] * ownNear.side[1] >= 0) continue
    if (streetKey(way.name) !== key) continue
    gap = gap === null ? near.dist : Math.min(gap, near.dist)
  }
  return gap
}

/** The station's entrances on the file's decimeter grid, joined to their streets, sorted by x, z, then type.
 *  `station` is its stations.json row; `allRows` its catalog rows (`entrancesByStation`): those that list it, and the
 *  complex's other rows, of which those past SHARED_MAX_M are dropped, and elevators too unless `lead` (logged once per
 *  station). `lead` is a complex's lead member, the only one the map focuses: its file stands for the whole merged
 *  station, so another member's elevators serve the station the user opened and stay. */
export function buildEntrances(
  station: { id: StationId; name: string } & LatLon,
  allRows: readonly EntranceInput[],
  file: FileStreets,
  lead = false,
): { entrances: StreetEntrance[]; log: BuildLog[] } {
  const ways = toJoinWays(file)
  const log: BuildLog[] = []
  const who = `${station.id} ${station.name}`
  // A row shared from another member of the complex (it does not list this station) is dropped when it is an elevator
  // (one that does not list a member does not serve its trains, and an elevator ranks first on the map and in the list;
  // a lead keeps them, its file being the merged station's) or when it lies near or past the street radius: the streets there are cut off or gone, so it would be a mark
  // without a label. The rows that list the station always stay.
  const far = (row: EntranceInput): boolean => {
    const g = toGround({ lat: row.lat, lon: row.lon }, station)
    return Math.hypot(Math.round(g.x * 10), Math.round(g.z * 10)) / 10 > SHARED_MAX_M
  }
  const shared = (row: EntranceInput): boolean => !row.gtfsStopIds.includes(station.id)
  const dropsElevator = (row: EntranceInput): boolean => !lead && row.type === ELEVATOR
  const elevators = allRows.filter((row) => shared(row) && dropsElevator(row)).length
  const rows = allRows.filter((row) => !shared(row) || (!dropsElevator(row) && !far(row)))
  if (rows.length < allRows.length) {
    const beyond = allRows.length - rows.length - elevators
    log.push({
      kind: 'shared-dropped',
      line: `dropped ${allRows.length - rows.length} shared complex entrance(s) (${elevators} elevator(s), ${beyond} beyond ${SHARED_MAX_M} m): ${who}`,
    })
  }
  if (rows.length === 0) log.push({ kind: 'no-entrances', line: `no entrances in the catalog: ${who}` })
  const entrances = rows.map((row): StreetEntrance => {
    const g = toGround({ lat: row.lat, lon: row.lon }, station)
    // + 0 turns a rounded -0 into 0, so the file never differs by a sign of zero.
    const x = Math.round(g.x * 10) + 0
    const z = Math.round(g.z * 10) + 0
    const p: [number, number] = [x / 10, z / 10]
    const join = joinEntrance(p, ways)
    const where = `${who} ${row.type} ${metersAt(x, z)}`
    if (join.street === null) {
      log.push({ kind: 'no-street', line: `no street within ${JOIN_RADIUS_M} m: ${where}` })
    } else if (join.side !== 'median') {
      const gap = nearMissGapM(p, join.wayId!, ways)
      if (gap !== null) log.push({ kind: 'near-miss', gapM: gap, line: `near miss for a median (other carriageway ${gap.toFixed(1)} m): ${where} on ${join.street}` })
    }
    for (const [role, id, name] of [['street', join.wayId, join.street], ['cross', join.crossWayId, join.cross]] as const) {
      const tags = id === null ? undefined : file.tags.get(id)
      const found = (['bridge', 'tunnel'] as const).filter((k) => tags?.[k] !== undefined && tags[k] !== 'no').map((k) => `${k}=${tags![k]}`)
      if (found.length > 0) {
        const layer = tags?.layer === undefined ? '' : ` layer=${tags.layer}`
        log.push({ kind: 'bridge-tunnel', line: `${role} way ${id} "${name}" is ${found.join(' ')}${layer}: ${where}` })
      }
    }
    const far = Math.hypot(x, z) / 10
    if (far > RADIUS_M - EDGE_MARGIN_M) {
      log.push({ kind: 'far-entrance', line: `entrance ${far.toFixed(0)} m from the anchor (streets past ${RADIUS_M} m are cut): ${where}` })
    }
    return { x, z, type: row.type, entry: row.entry, exit: row.exit, stopIds: [...new Set(row.gtfsStopIds)].sort(), ...join }
  })
  entrances.sort((a, b) => a.x - b.x || a.z - b.z || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  return { entrances, log }
}
