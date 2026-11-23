/**
 * The gzip budget of the top-level public/data/*.json the client loads up front (GTFS files and
 * station-depths.json), shared by build-data.ts, build-access.ts and build-stations.ts: the one size limit.
 * Per-station interiors (public/data/stations/), street files (streets/), timetables (timetable/) and the router's
 * transfers (route/transfers.json) load on demand and don't count.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

export const GZIP_BUDGET_BYTES = 60_000
/** stations/index.json loads after startup (not render-blocking), so it has its own cap outside the budget above. */
export const INDEX_GZIP_CAP_BYTES = 8_000
/** stations/equipment.json loads on the first station focus, outside the budget above, with its own cap: the measured
 *  12,896 B (node zlib level 9, fall 2026) plus about a quarter. */
export const EQUIPMENT_GZIP_CAP_BYTES = 16_000

/** public/data/route/transfers.json loads when the trip panel plans, outside the budget above: the measured 970 B
 *  (node zlib level 9, fall 2026) plus about a quarter. */
export const TRANSFERS_GZIP_CAP_BYTES = 1_250

/** public/data/streets/<id>.json loads on focus, outside the budget above; each file has this cap... */
export const STREETS_FILE_GZIP_CAP_BYTES = 16_000
/** ...and the directory this one: the measured total plus a quarter, rounded up, so growth in the pin shows in review. */
export const STREETS_TOTAL_GZIP_CAP_BYTES = 1_800_000

/** public/data/walk/<id>.json loads on demand (the walk router), outside the budget above; each file has this cap... */
export const WALK_FILE_GZIP_CAP_BYTES = 64_000
/** ...and the directory this one: the measured total (3,629,681 B) plus about a quarter, rounded up. */
export const WALK_TOTAL_GZIP_CAP_BYTES = 4_600_000
/** worker/data/streetIndex.json (the Worker's bundled street and intersection index, 2q7.14) is measured raw, since a
 *  Worker's size limit counts the uncompressed script: the committed file (about 690,740 B, fall 2026) plus about three tenths. */
export const STREET_INDEX_RAW_CAP_BYTES = 900_000
/** public/data/timetable/<serviceId>.json loads on demand, outside the budget above; each file has this cap:
 *  the committed Weekday file (39,662 B, node zlib level 9, fall 2026) plus about a fifth. */
export const TIMETABLE_FILE_GZIP_CAP_BYTES = 48_000
/** timetable/dated/<date>.json (built by each deploy, never committed) shares the per-file cap above (the largest, a heavy weekday, is 40,595 B, fall
 *  2026); the directory (at most 14 files) has this total: the measured nine-day window (237,956 B) plus about two thirds. */
export const TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES = 400_000

export interface RenderedFile {
  name: string
  text: string
  raw: number
  gzip: number
}

/** Gzip sizes of the committed top-level *.json in `dir` except `exclude` (the files being rebuilt); {} if `dir` is missing. */
export function committedGzip(dir: URL, exclude: ReadonlySet<string>): Record<string, number> {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  const out: Record<string, number> = {}
  for (const name of names.sort()) {
    if (name.endsWith('.json') && !exclude.has(name)) out[name] = gzipSync(readFileSync(new URL(name, dir)), { level: 9 }).length
  }
  return out
}

export function renderedFile(name: string, text: string): RenderedFile {
  return { name, text, raw: Buffer.byteLength(text), gzip: gzipSync(text, { level: 9 }).length }
}

/** `files` plus the committed `others` (name to gzip bytes) must fit the budget; returns the total. */
export function checkBudget(files: readonly RenderedFile[], others: Readonly<Record<string, number>> = {}): number {
  const sizes = [...files.map((f) => [f.name, f.gzip] as const), ...Object.entries(others)]
  const total = sizes.reduce((sum, [, gzip]) => sum + gzip, 0)
  if (total > GZIP_BUDGET_BYTES) {
    const list = sizes.map(([name, gzip]) => `${name} ${gzip}`).join(', ')
    throw new Error(`Gzipped total ${total} B is over the ${GZIP_BUDGET_BYTES} B budget (${list}). Nothing written.`)
  }
  return total
}

/** A file outside the budget must fit its own cap; returns its gzip size. */
export function checkFileCap(file: RenderedFile, capBytes: number): number {
  if (file.gzip > capBytes) {
    throw new Error(`${file.name} is ${file.gzip} B gzipped, over its ${capBytes} B cap. Nothing written.`)
  }
  return file.gzip
}

/** The station index must fit its own cap; returns its gzip size. */
export function checkIndexCap(index: RenderedFile): number {
  return checkFileCap(index, INDEX_GZIP_CAP_BYTES)
}

/** The equipment index must fit its own cap; returns its gzip size. */
export function checkEquipmentCap(file: RenderedFile): number {
  return checkFileCap(file, EQUIPMENT_GZIP_CAP_BYTES)
}

/** The dated timetable files together must fit their total cap; returns their gzip total. */
export function checkDatedTimetableTotal(files: readonly RenderedFile[], capBytes: number = TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES): number {
  const total = files.reduce((sum, f) => sum + f.gzip, 0)
  if (total > capBytes) throw new Error(`The ${files.length} dated timetable files total ${total} B gzipped, over the ${capBytes} B cap. Nothing written.`)
  return total
}

/** The street files together must fit their total cap; returns their gzip total. */
export function checkStreetsTotal(files: readonly RenderedFile[], capBytes: number = STREETS_TOTAL_GZIP_CAP_BYTES): number {
  const total = files.reduce((sum, f) => sum + f.gzip, 0)
  if (total > capBytes) throw new Error(`The ${files.length} street files total ${total} B gzipped, over the ${capBytes} B cap. Nothing written.`)
  return total
}

/** The walk files together must fit their total cap; returns their gzip total. */
export function checkWalkTotal(files: readonly RenderedFile[], capBytes: number = WALK_TOTAL_GZIP_CAP_BYTES): number {
  const total = files.reduce((sum, f) => sum + f.gzip, 0)
  if (total > capBytes) throw new Error(`The ${files.length} walk files total ${total} B gzipped, over the ${capBytes} B cap. Nothing written.`)
  return total
}

/** The street index file must fit its raw cap; returns its raw size. */
export function checkStreetIndexCap(file: RenderedFile, capBytes: number = STREET_INDEX_RAW_CAP_BYTES): number {
  if (file.raw > capBytes) throw new Error(`${file.name} is ${file.raw} B raw, over the ${capBytes} B cap. Nothing written.`)
  return file.raw
}
