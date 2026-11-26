/** Pure trimming and validation of the raw data.ny.gov (SODA) responses for the station catalog.
 *  Everything fetched is untrusted: each field is checked here and failures name the row. */
import { list, oneOf, optText, record, text } from './check.ts'
import type { CatalogAmenity, CatalogEntrance, CatalogEquipment, CatalogStation } from './catalogTypes.ts'
import { AMENITY_TYPES, STRUCTURES } from './catalogTypes.ts'
import { entranceRow, epochToIso, num } from './stationSources.ts'

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function routes(v: unknown, path: string): string[] {
  const out = text(v, path).trim().split(/\s+/)
  if (out.some((r) => r === '')) throw new Error(`${path}: empty route in ${JSON.stringify(v)}`)
  return out
}

/** `+` true, `-` false, absent null. */
function flag(v: unknown, path: string): boolean | null {
  return v === undefined ? null : oneOf(v, ['+', '-'], path) === '+'
}

function optYesNo(v: unknown, path: string): boolean | null {
  return v === undefined ? null : oneOf(v, ['YES', 'NO'], path) === 'YES'
}

/** E&E MRNs are zero padded ("059"); 39hk-dx4f station ids are not ("59"). Absent is null. */
export function normalizeMrn(v: unknown, path = 'mrn'): string | null {
  if (v === undefined) return null
  if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Error(`${path}: expected digits, got ${JSON.stringify(v)}`)
  return String(Number(v))
}

/** The `[{"count":"496"}]` answer to `$select=count(*)`. */
export function parseCount(json: unknown, dataset: string): number {
  const row = record(list(json, `${dataset} count`)[0], `${dataset} count[0]`)
  return num(row.count, `${dataset} count[0].count`)
}

/** The `[{"max_month":"2026-10-01T00:00:00.000"}]` answer to `$select=max(month)`, as `2026-10-01`. */
export function parseLatestMonth(json: unknown, dataset: string): string {
  const row = record(list(json, `${dataset} max(month)`)[0], `${dataset} max(month)[0]`)
  return monthOf(row.max_month, `${dataset} max(month)[0].max_month`)
}

/** `2026-10-01T00:00:00.000` to `2026-10-01`; anything but the first of a month is refused. */
function monthOf(v: unknown, path: string): string {
  const m = /^(\d{4}-\d{2})-01T00:00:00(?:\.000)?$/.exec(text(v, path))
  if (m === null) throw new Error(`${path}: expected the first of a month at midnight, got ${JSON.stringify(v)}`)
  return `${m[1]}-01`
}

/** A short or long page means the dataset changed mid-fetch or the limit cut it off; refuse either way. */
export function assertRowCount(rows: unknown, count: number, dataset: string): void {
  const got = list(rows, dataset).length
  if (got !== count) throw new Error(`${dataset}: got ${got} rows but count(*) says ${count}`)
}

/** What the view metadata says about a dataset (`/api/views/<id>.json`). */
export interface ViewMeta {
  title: string
  attribution: string
  attributionLink: string
  rowsUpdatedAt: string
}

export function parseViewMeta(json: unknown, dataset: string): ViewMeta {
  const meta = record(json, `${dataset} view`)
  return {
    title: text(meta.name, `${dataset} view.name`),
    attribution: text(meta.attribution, `${dataset} view.attribution`),
    attributionLink: text(meta.attributionLink, `${dataset} view.attributionLink`),
    rowsUpdatedAt: epochToIso(meta.rowsUpdatedAt, `${dataset} view.rowsUpdatedAt`),
  }
}

/** 39hk-dx4f rows, sorted by gtfsStopId. */
export function trimCatalogStations(rows: unknown): CatalogStation[] {
  return list(rows, 'stations')
    .map((r, i): CatalogStation => {
      const at = `stations[${i}]`
      const row = record(r, at)
      const adaNotes = text(row.ada_notes, `${at}.ada_notes`)
      return {
        gtfsStopId: text(row.gtfs_stop_id, `${at}.gtfs_stop_id`),
        stationId: text(row.station_id, `${at}.station_id`),
        complexId: text(row.complex_id, `${at}.complex_id`),
        division: text(row.division, `${at}.division`),
        line: text(row.line, `${at}.line`),
        name: text(row.stop_name, `${at}.stop_name`),
        borough: text(row.borough, `${at}.borough`),
        routes: routes(row.daytime_routes, `${at}.daytime_routes`),
        structure: oneOf(row.structure, STRUCTURES, `${at}.structure`),
        lat: num(row.gtfs_latitude, `${at}.gtfs_latitude`),
        lon: num(row.gtfs_longitude, `${at}.gtfs_longitude`),
        ada: Number(oneOf(row.ada, ['0', '1', '2'], `${at}.ada`)),
        adaNorth: oneOf(row.ada_northbound, ['0', '1'], `${at}.ada_northbound`) === '1',
        adaSouth: oneOf(row.ada_southbound, ['0', '1'], `${at}.ada_southbound`) === '1',
        adaNotes: adaNotes === 'NaN' ? null : adaNotes,
        northLabel: text(row.north_direction_label, `${at}.north_direction_label`),
        southLabel: text(row.south_direction_label, `${at}.south_direction_label`),
      }
    })
    .sort((a, b) => byText(a.gtfsStopId, b.gtfsStopId))
}

/** i9wp-a4ja rows with their station keys, sorted by stationId, lat, lon (then type for a stable tie). */
export function trimCatalogEntrances(rows: unknown): CatalogEntrance[] {
  return list(rows, 'entrances')
    .map((r, i): CatalogEntrance => {
      const at = `entrances[${i}]`
      const row = record(r, at)
      return {
        ...entranceRow(r, at),
        gtfsStopIds: text(row.gtfs_stop_id, `${at}.gtfs_stop_id`).split(/\s*;\s*/),
        stationId: text(row.station_id, `${at}.station_id`),
        complexId: text(row.complex_id, `${at}.complex_id`),
      }
    })
    .sort((a, b) => Number(a.stationId) - Number(b.stationId) || a.lat - b.lat || a.lon - b.lon || byText(a.type, b.type))
}

/** 94fv-bak7 rows, sorted by code. Unlike the per-station trimmer this accepts the gaps of the whole
 *  inventory (yard machines have no station or coordinates). x_coordinate is latitude, y_coordinate
 *  longitude. Status, dates and alternative routes are left out: they change daily. */
export function trimCatalogEquipment(rows: unknown): CatalogEquipment[] {
  const out = list(rows, 'equipment')
    .map((r, i): CatalogEquipment => {
      const at = `equipment[${i}]`
      const row = record(r, at)
      const kind = oneOf(row.elevator_or_escalator, ['Elevator', 'Escalator'], `${at}.elevator_or_escalator`)
      const lat = row.x_coordinate === undefined ? null : num(row.x_coordinate, `${at}.x_coordinate`)
      const lon = row.y_coordinate === undefined ? null : num(row.y_coordinate, `${at}.y_coordinate`)
      if ((lat === null) !== (lon === null)) throw new Error(`${at}: has only one of x_coordinate and y_coordinate`)
      return {
        code: text(row.equipment_code, `${at}.equipment_code`),
        kind: kind === 'Elevator' ? 'elevator' : 'escalator',
        revenue: oneOf(row.revenue_machine, ['YES', 'NO'], `${at}.revenue_machine`) === 'YES',
        stationId: normalizeMrn(row.station_mrn, `${at}.station_mrn`),
        complexId: normalizeMrn(row.station_complex_mrn, `${at}.station_complex_mrn`),
        lat,
        lon,
        serving: optText(row.notes, `${at}.notes`),
        rise: optText(kind === 'Elevator' ? row.elevator_rise : row.escalator_rise, `${at}.rise`),
        landings: optText(row.elevator_number_of_landings, `${at}.elevator_number_of_landings`),
        direction: optText(row.elevator_direction_serviced, `${at}.elevator_direction_serviced`),
        ada: optYesNo(row.ada_compliant, `${at}.ada_compliant`),
        streetAccess: optYesNo(row.street_access, `${at}.street_access`),
        mezzanine1Access: flag(row.elevator_mezzanine_1_access, `${at}.elevator_mezzanine_1_access`),
        mezzanine2Access: flag(row.elevator_mezzanine_2_access, `${at}.elevator_mezzanine_2_access`),
        platformAccess: flag(row.elevator_platform_access, `${at}.elevator_platform_access`),
      }
    })
    .sort((a, b) => byText(a.code, b.code))
  out.forEach((e, i) => {
    if (i > 0 && out[i - 1]!.code === e.code) throw new Error(`equipment: duplicate code ${e.code}`)
  })
  return out
}

/** 6yjv-fk7g rows (restrooms, one month), sorted by id. The station is keyed by `station_mrn`, which is padded
 *  or not like the E&E one, so it goes through `normalizeMrn`; name, lines, borough and the station's own point
 *  are left out (the station list has them). A row with no id, an unknown type or no station throws. */
export function trimCatalogAmenities(rows: unknown): CatalogAmenity[] {
  const out = list(rows, 'amenities')
    .map((r, i): CatalogAmenity => {
      const at = `amenities[${i}]`
      const row = record(r, at)
      const stationId = normalizeMrn(row.station_mrn, `${at}.station_mrn`)
      if (stationId === null) throw new Error(`${at}: has no station_mrn`)
      return {
        id: text(row.amenity_id, `${at}.amenity_id`),
        type: oneOf(row.amenity_type, AMENITY_TYPES, `${at}.amenity_type`),
        stationId,
        month: monthOf(row.month, `${at}.month`),
      }
    })
    .sort((a, b) => byText(a.id, b.id))
  out.forEach((a, i) => {
    if (i > 0 && out[i - 1]!.id === a.id) throw new Error(`amenities: duplicate id ${a.id}`)
  })
  return out
}
