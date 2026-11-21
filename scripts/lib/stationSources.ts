/** Pure trimming and validation of the raw Overpass and SODA responses. Everything fetched is
 *  untrusted: each field is checked at this boundary and failures name the row or element. */
import type { LevelKind } from '../../src/data/stationSchema.ts'
import { finite, list, oneOf, record, text } from './check.ts'
import type { EntranceRow, EquipmentRow, OsmWay } from './stationInputs.ts'

const KEPT_TAGS = ['level', 'name', 'railway']

export function epochToIso(seconds: unknown, path: string): string {
  return new Date(finite(seconds, path) * 1000).toISOString()
}

function num(v: unknown, path: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return finite(n, path)
}

function yesNo(v: unknown, path: string): boolean {
  return oneOf(v, ['YES', 'NO'], path) === 'YES'
}

/** Overpass `out geom meta` JSON to the requested ways (in `ids` order) and the OSM base timestamp. */
export function trimOverpassWays(json: unknown, ids: number[]): { baseTimestamp: string; ways: OsmWay[] } {
  const root = record(json, 'overpass')
  const baseTimestamp = text(record(root.osm3s, 'overpass.osm3s').timestamp_osm_base, 'overpass.osm3s.timestamp_osm_base')
  const elements = list(root.elements, 'overpass.elements').map((e, i) => record(e, `overpass.elements[${i}]`))
  const ways = ids.map((id): OsmWay => {
    const el = elements.find((e) => e.type === 'way' && e.id === id)
    if (!el) throw new Error(`overpass: way ${id} not in the response`)
    const at = `overpass way ${id}`
    const ring = list(el.geometry, `${at}.geometry`).map((p, i): [number, number] => {
      const pt = record(p, `${at}.geometry[${i}]`)
      return [finite(pt.lat, `${at}.geometry[${i}].lat`), finite(pt.lon, `${at}.geometry[${i}].lon`)]
    })
    if (ring.length < 4) throw new Error(`${at}: expected a closed ring, got ${ring.length} points`)
    const tags = record(el.tags ?? {}, `${at}.tags`)
    return {
      id,
      version: finite(el.version, `${at}.version`),
      timestamp: text(el.timestamp, `${at}.timestamp`),
      tags: Object.fromEntries(KEPT_TAGS.filter((k) => typeof tags[k] === 'string').map((k) => [k, tags[k] as string])),
      ring,
    }
  })
  return { baseTimestamp, ways }
}

/** SODA i9wp-a4ja rows, sorted by lat then lon. */
export function trimEntrances(rows: unknown): EntranceRow[] {
  return list(rows, 'entrances')
    .map((r, i) => {
      const at = `entrances[${i}]`
      const row = record(r, at)
      return {
        type: text(row.entrance_type, `${at}.entrance_type`),
        entry: yesNo(row.entry_allowed, `${at}.entry_allowed`),
        exit: yesNo(row.exit_allowed, `${at}.exit_allowed`),
        lat: num(row.entrance_latitude, `${at}.entrance_latitude`),
        lon: num(row.entrance_longitude, `${at}.entrance_longitude`),
      }
    })
    .sort((a, b) => a.lat - b.lat || a.lon - b.lon)
}

/** SODA 94fv-bak7 rows, sorted by code. The dataset's x_coordinate holds latitude and
 *  y_coordinate holds longitude. */
export function trimEquipment(rows: unknown): EquipmentRow[] {
  return list(rows, 'equipment')
    .map((r, i): EquipmentRow => {
      const at = `equipment[${i}]`
      const row = record(r, at)
      const kind = oneOf(row.elevator_or_escalator, ['Elevator', 'Escalator'], `${at}.elevator_or_escalator`)
      return {
        code: text(row.equipment_code, `${at}.equipment_code`),
        kind: kind === 'Elevator' ? 'elevator' : 'escalator',
        lat: num(row.x_coordinate, `${at}.x_coordinate`),
        lon: num(row.y_coordinate, `${at}.y_coordinate`),
        serving: text(row.notes, `${at}.notes`),
      }
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
}

function sideKind(side: string): LevelKind {
  if (/platform/i.test(side)) return 'platform'
  if (/mezzanine/i.test(side)) return 'mezzanine'
  return 'street'
}

/** Splits an E&E serving text on its first " to " and classifies each side by keyword. */
export function parseServing(serving: string): { from: LevelKind; to: LevelKind } {
  const at = serving.search(/ to /i)
  if (at < 0) throw new Error(`serving text has no " to ": ${JSON.stringify(serving)}`)
  return { from: sideKind(serving.slice(0, at)), to: sideKind(serving.slice(at + 4)) }
}
