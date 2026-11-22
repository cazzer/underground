/** Builds public/data/*.json from the regular MTA static GTFS zip, and the dated timetables from the supplemented
 *  zip. The only file here that does IO.
 *
 *  npm run data                                       download both feeds (gtfs_subway.zip, gtfs_supplemented.zip)
 *  npm run data -- --zip reg.zip --supplemented-zip supp.zip   use local zips (each flag wins over its variable)
 *  GTFS_ZIP=reg.zip GTFS_SUPPLEMENTED_ZIP=supp.zip npm run data   same, via the environment
 *
 *  The static network (stations, routes, shapes, segments, transfers, trip index, per-service timetables) comes from
 *  the regular zip only: 6,958 of the supplemented feed's trips have no shape_id. The supplemented zip (the next
 *  seven days with planned work applied) feeds only public/data/timetable/dated/ (see src/data/timetableSchema.ts).
 *  A failed supplemented download or build fails the whole run (the refresh then opens no PR that day), and the
 *  dated files age out: on a date with no dated file the client uses the per-service files, which are exact there.
 *  A date gets a file when the supplemented feed runs different trips on it than the regular feed (see lib/datedTimetable.ts).
 *
 *  Borough and ADA status per station come from the pinned data/stations/catalog/stations.json
 *  (39hk-dx4f; refresh it with `npm run data:catalog:fetch`, then run the offline `npm run data:access`)
 *  and data/stations/access-exceptions.json.
 *
 *  The router's transfers go to public/data/route/transfers.json: loaded when the trip panel plans, outside the budget,
 *  under TRANSFERS_GZIP_CAP_BYTES.
 *
 *  stations.json also carries `complexes`, the catalog's complex_id groups (lead first; see lib/stationComplexes.ts).
 *
 *  Also writes public/data/timetable/<serviceId>.json, one per service: loaded on demand, outside the budget, each
 *  under TIMETABLE_FILE_GZIP_CAP_BYTES. A file there for a service the feed no longer has is removed. Likewise
 *  timetable/dated/<YYYYMMDD>.json plus index.json (each under that cap, the directory under
 *  TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES).
 *
 *  Everything is built in memory first; nothing is written if a build step throws, the gzipped total is over
 *  budget or a timetable file is over its cap. */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { unzipSync } from 'fflate'
import type { StopId } from '../src/data/schema.ts'
import type { StationChange } from '../src/data/timetableSchema.ts'
import { nyDate } from '../src/lib/realtime/serviceDate.ts'
import { readFeed, type GtfsFeed } from './lib/gtfs.ts'
import { buildRoutes, buildStations, buildTransfers } from './lib/network.ts'
import { addAccess } from './lib/stationAccess.ts'
import { readAccessExceptions, readCatalogStations } from './lib/accessInputs.ts'
import { buildComplexes } from './lib/stationComplexes.ts'
import {
  GZIP_BUDGET_BYTES,
  TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES,
  TIMETABLE_FILE_GZIP_CAP_BYTES,
  TRANSFERS_GZIP_CAP_BYTES,
  checkBudget,
  checkDatedTimetableTotal,
  checkFileCap,
  committedGzip,
  renderedFile,
  type RenderedFile,
} from './lib/budget.ts'
import { buildDatedTimetables, serviceDays, type ServiceDays } from './lib/datedTimetable.ts'
import { buildSegments } from './lib/segments.ts'
import { buildShapes } from './lib/shapes.ts'
import { toStableJson } from './lib/stableJson.ts'
import { buildStationChanges, buildTimetables } from './lib/timetable.ts'
import { buildTripIndex } from './lib/tripIndex.ts'

const FEED_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip'
const SUPPLEMENTED_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip'
const OUT_DIR = new URL('../public/data/', import.meta.url)
const ROUTE_DIR = new URL('route/', OUT_DIR)
const TIMETABLE_DIR = new URL('timetable/', OUT_DIR)
const DATED_DIR = new URL('dated/', TIMETABLE_DIR)
const SIMPLIFY_TOLERANCE_M = 3
const NEEDED = new Set(
  ['stops', 'routes', 'trips', 'stop_times', 'shapes', 'transfers', 'calendar', 'calendar_dates', 'feed_info'].map(
    (name) => `${name}.txt`,
  ),
)

async function loadZip(zipPath: string | undefined, url: string): Promise<Uint8Array> {
  if (zipPath) {
    console.log(`Reading ${zipPath}`)
    return readFileSync(zipPath)
  }
  console.log(`Downloading ${url}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`Download of ${url} failed: HTTP ${res.status} ${res.statusText}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  console.log(`Downloaded ${bytes.length} bytes, Last-Modified: ${res.headers.get('last-modified') ?? 'unknown'}`)
  return bytes
}

/** `shapes: false` leaves shapes.txt out (the dated build never reads shapes, and they cost memory); pass the same flag to readFeed. */
function decodeTables(zip: Uint8Array, shapes = true): Record<string, string> {
  const needed = new Set([...NEEDED].filter((name) => shapes || name !== 'shapes.txt'))
  const files = unzipSync(zip, { filter: (f) => needed.has(f.name) })
  const missing = [...needed].filter((name) => !(name in files))
  if (missing.length > 0) throw new Error(`Zip is missing ${missing.join(', ')}`)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, decoder.decode(bytes)]))
}

/** Everything the regular zip yields, rendered, plus what the dated build needs from it. The feed itself stays in
 *  here, so it can be collected before the (larger) supplemented zip is read. */
async function buildRegular(zip: Uint8Array) {
  const feed = readFeed(decodeTables(zip))
  const { feedVersion } = feed
  console.log(`Feed version: ${feedVersion}`)

  const { segments, skipped: skippedSegments } = buildSegments(feed.stopTimes)
  const { file: tripIndex, skippedNoShape } = buildTripIndex(feed)
  const catalogStations = readCatalogStations()
  const access = addAccess(buildStations(feed), catalogStations, readAccessExceptions())
  for (const warning of access.warnings) console.warn(`WARNING: ${warning}`)
  const complexes = buildComplexes(access.stations, catalogStations)
  for (const warning of complexes.warnings) console.warn(`WARNING: ${warning}`)
  const timetables = buildTimetables(feed)
  const outputs: [string, unknown, number][] = [
    ['stations.json', { feedVersion, stations: access.stations, complexes: complexes.complexes }, 2],
    ['routes.json', { feedVersion, routes: buildRoutes(feed) }, 2],
    ['shapes.json', { feedVersion, shapes: buildShapes(feed, SIMPLIFY_TOLERANCE_M) }, 2],
    ['segments.json', { feedVersion, segments }, 2],
    ['trip-index.json', { feedVersion, ...tripIndex }, 3],
  ]
  const rendered = outputs.map(([name, value, lineDepth]) => renderedFile(name, toStableJson(value, lineDepth)))
  // route/transfers.json loads when the trip panel plans, so it is outside the startup budget (its own cap).
  const transfers = renderedFile('transfers.json', toStableJson({ feedVersion, transfers: buildTransfers(feed) }, 2))
  const timetableFiles = timetables.files.map(({ serviceId, file }) => renderedFile(`${serviceId}.json`, toStableJson(file, 4)))
  const patterns = timetables.files.flatMap(({ file }) => file.patterns)
  return {
    feedVersion,
    rendered,
    transfers,
    timetableFiles,
    // Every child stop stations.json lists: the dated files may call at no other.
    knownStops: new Set<StopId>(access.stations.flatMap((s) => s.stops)),
    changes: buildStationChanges(feed),
    days: serviceDays(feed),
    stats:
      `Timetables: ${timetables.files.length} files, ${patterns.length} patterns, ` +
      `${patterns.reduce((n, p) => n + p.trips.length, 0)} trips, ` +
      `${timetables.files[0]?.file.changes.length ?? 0} station changes, ${timetables.skippedShort} trips under two stops skipped, ` +
      `${timetables.splitPatterns} patterns split for overtaking`,
    skipped: `Skipped: ${skippedSegments} non-positive segment samples, ${skippedNoShape} trips without a shape`,
  }
}

/** The dated files and manifest, rendered, built from the supplemented zip with the regular feed's station changes. */
function buildDated(feed: GtfsFeed, regular: { feedVersion: string; changes: readonly StationChange[]; knownStops: ReadonlySet<StopId>; days: ServiceDays }) {
  console.log(`Supplemented feed version: ${feed.feedVersion}`)
  if (feed.feedVersion !== regular.feedVersion) {
    console.warn(`WARNING: the supplemented feed_version (${feed.feedVersion}) differs from the regular one (${regular.feedVersion}); the two feeds may not match`)
  }
  const built = buildDatedTimetables(feed, regular.days, regular.changes, regular.knownStops)
  const { dates } = built.index
  if (dates.length === 0) {
    console.warn('WARNING: the supplemented feed runs the same trips as the regular one on every date, so there are no dated timetables')
  } else if (dates[dates.length - 1]! < nyDate(Date.now() / 1000)) {
    console.warn(`WARNING: the last dated file is ${dates[dates.length - 1]}, before today in New York; the files are stale`)
  }
  const files = built.files.map(({ date, file }) => renderedFile(`${date}.json`, toStableJson(file, 4)))
  const index = renderedFile('index.json', toStableJson(built.index, 1))
  const patterns = built.files.flatMap(({ file }) => file.patterns)
  const summary =
    `Dated timetables: ${dates.length} files [${dates.join(' ')}], ${patterns.length} patterns, ` +
    `${patterns.reduce((n, p) => n + p.trips.length, 0)} trips, ${built.skippedShort} trips under two stops skipped, ` +
    `${built.splitPatterns} patterns split for overtaking`
  return { files, index, summary }
}

/** Replaces `dir`'s *.json with `written`, removing the rest (a stale file the feed no longer has); `label` names it in the log. */
function pruneJson(dir: URL, written: ReadonlySet<string>, label: string, why: string): void {
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || written.has(name)) continue
    rmSync(join(fileURLToPath(dir), name))
    console.log(`${label}${name}: removed (${why})`)
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { zip: { type: 'string' }, 'supplemented-zip': { type: 'string' } }, strict: true })
  const regular = await buildRegular(await loadZip(values.zip ?? process.env.GTFS_ZIP, FEED_URL))
  // buildRegular's feed is out of scope here, so it can be collected before the supplemented one is read.
  const suppZip = await loadZip(values['supplemented-zip'] ?? process.env.GTFS_SUPPLEMENTED_ZIP, SUPPLEMENTED_URL)
  const dated = buildDated(readFeed(decodeTables(suppZip, false), { shapes: false }), regular)

  const { rendered, transfers, timetableFiles } = regular
  // station-depths.json (data:stations) counts too: the shared budget covers everything loaded up front.
  const others = committedGzip(OUT_DIR, new Set(rendered.map((f) => f.name)))
  const totalGzip = checkBudget(rendered, others)
  checkFileCap(transfers, TRANSFERS_GZIP_CAP_BYTES)
  for (const f of timetableFiles) checkFileCap(f, TIMETABLE_FILE_GZIP_CAP_BYTES)
  for (const f of dated.files) checkFileCap(f, TIMETABLE_FILE_GZIP_CAP_BYTES)
  const datedGzip = checkDatedTimetableTotal(dated.files)

  mkdirSync(OUT_DIR, { recursive: true })
  for (const f of rendered) writeFileSync(new URL(f.name, OUT_DIR), f.text)
  mkdirSync(ROUTE_DIR, { recursive: true })
  writeFileSync(new URL(transfers.name, ROUTE_DIR), transfers.text)
  mkdirSync(TIMETABLE_DIR, { recursive: true })
  for (const f of timetableFiles) writeFileSync(new URL(f.name, TIMETABLE_DIR), f.text)
  pruneJson(TIMETABLE_DIR, new Set(timetableFiles.map((f) => f.name)), 'timetable/', 'no such service any more')
  mkdirSync(DATED_DIR, { recursive: true })
  const datedOut: RenderedFile[] = [...dated.files, dated.index]
  for (const f of datedOut) writeFileSync(new URL(f.name, DATED_DIR), f.text)
  pruneJson(DATED_DIR, new Set(datedOut.map((f) => f.name)), 'timetable/dated/', 'its date has no planned work now')

  console.table([
    ...rendered.map((f) => ({ file: f.name, 'raw B': f.raw, 'gzip B': f.gzip })),
    ...Object.entries(others).map(([file, gzip]) => ({ file: `${file} (committed)`, 'raw B': null, 'gzip B': gzip })),
  ])
  console.log(`Total gzip: ${totalGzip} B (budget ${GZIP_BUDGET_BYTES} B)`)
  console.log(`route/transfers.json: ${transfers.raw} B raw, ${transfers.gzip} B gzip (cap ${TRANSFERS_GZIP_CAP_BYTES} B, outside the budget)`)
  console.table(timetableFiles.map((f) => ({ file: `timetable/${f.name}`, 'raw B': f.raw, 'gzip B': f.gzip, 'cap B': TIMETABLE_FILE_GZIP_CAP_BYTES })))
  console.log(regular.stats)
  console.table(datedOut.map((f) => ({ file: `timetable/dated/${f.name}`, 'raw B': f.raw, 'gzip B': f.gzip, 'cap B': TIMETABLE_FILE_GZIP_CAP_BYTES })))
  console.log(`${dated.summary}, ${datedGzip} B gzip (cap ${TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES} B)`)
  console.log(regular.skipped)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
