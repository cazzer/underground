/** Builds public/data/*.json from the regular MTA static GTFS zip. The only file here that does IO.
 *
 *  npm run data                       download gtfs_subway.zip
 *  npm run data -- --zip reg.zip      use a local zip (the flag wins over GTFS_ZIP)
 *  GTFS_ZIP=reg.zip npm run data      same, via the environment
 *
 *  The static network (stations, routes, shapes, segments, transfers, trip index, per-service timetables) comes from
 *  the regular zip only: 6,958 of the supplemented feed's trips have no shape_id. The supplemented feed (planned work)
 *  is not read here: its dated timetables are built by every Pages deploy, never committed (scripts/build-dated.ts).
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
 *  under TIMETABLE_FILE_GZIP_CAP_BYTES. A file there for a service the feed no longer has is removed.
 *
 *  Everything is built in memory first; nothing is written if a build step throws, the gzipped total is over
 *  budget or a timetable file is over its cap. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { readFeed } from './lib/gtfs.ts'
import { buildRoutes, buildStations, buildTransfers } from './lib/network.ts'
import { addAccess } from './lib/stationAccess.ts'
import { readAccessExceptions, readCatalogStations } from './lib/accessInputs.ts'
import { buildComplexes } from './lib/stationComplexes.ts'
import {
  GZIP_BUDGET_BYTES,
  TIMETABLE_FILE_GZIP_CAP_BYTES,
  TRANSFERS_GZIP_CAP_BYTES,
  checkBudget,
  checkFileCap,
  committedGzip,
  renderedFile,
} from './lib/budget.ts'
import { FEED_URL, REGULAR_MAX_BYTES, decodeTables, loadZip, pruneJson } from './lib/feedZip.ts'
import { buildSegments } from './lib/segments.ts'
import { buildShapes } from './lib/shapes.ts'
import { toStableJson } from './lib/stableJson.ts'
import { buildTimetables } from './lib/timetable.ts'
import { buildTripIndex } from './lib/tripIndex.ts'

const OUT_DIR = new URL('../public/data/', import.meta.url)
const ROUTE_DIR = new URL('route/', OUT_DIR)
const TIMETABLE_DIR = new URL('timetable/', OUT_DIR)
const SIMPLIFY_TOLERANCE_M = 3

/** Everything the regular zip yields, rendered. */
function buildRegular(zip: Uint8Array) {
  const feed = readFeed(decodeTables(zip))
  const { feedVersion } = feed
  console.log(`Feed version: ${feedVersion}`)

  const { segments, skipped: skippedSegments } = buildSegments(feed.stopTimes)
  const { file: tripIndex, skippedNoShape } = buildTripIndex(feed)
  const catalogStations = readCatalogStations()
  const exceptions = readAccessExceptions()
  const access = addAccess(buildStations(feed), catalogStations, exceptions)
  for (const warning of access.warnings) console.warn(`WARNING: ${warning}`)
  const complexes = buildComplexes(access.stations, catalogStations, exceptions.orphans)
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
    stats:
      `Timetables: ${timetables.files.length} files, ${patterns.length} patterns, ` +
      `${patterns.reduce((n, p) => n + p.trips.length, 0)} trips, ` +
      `${timetables.files[0]?.file.changes.length ?? 0} station changes, ${timetables.skippedShort} trips under two stops skipped, ` +
      `${timetables.splitPatterns} patterns split for overtaking`,
    skipped: `Skipped: ${skippedSegments} non-positive segment samples, ${skippedNoShape} trips without a shape`,
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { zip: { type: 'string' } }, strict: true })
  const regular = buildRegular(await loadZip(values.zip ?? process.env.GTFS_ZIP, FEED_URL, REGULAR_MAX_BYTES))

  const { rendered, transfers, timetableFiles } = regular
  // station-depths.json (data:stations) counts too: the shared budget covers everything loaded up front.
  const others = committedGzip(OUT_DIR, new Set(rendered.map((f) => f.name)))
  const totalGzip = checkBudget(rendered, others)
  checkFileCap(transfers, TRANSFERS_GZIP_CAP_BYTES)
  for (const f of timetableFiles) checkFileCap(f, TIMETABLE_FILE_GZIP_CAP_BYTES)

  mkdirSync(OUT_DIR, { recursive: true })
  for (const f of rendered) writeFileSync(new URL(f.name, OUT_DIR), f.text)
  mkdirSync(ROUTE_DIR, { recursive: true })
  writeFileSync(new URL(transfers.name, ROUTE_DIR), transfers.text)
  mkdirSync(TIMETABLE_DIR, { recursive: true })
  for (const f of timetableFiles) writeFileSync(new URL(f.name, TIMETABLE_DIR), f.text)
  pruneJson(fileURLToPath(TIMETABLE_DIR), new Set(timetableFiles.map((f) => f.name)), 'timetable/', 'no such service any more')

  console.table([
    ...rendered.map((f) => ({ file: f.name, 'raw B': f.raw, 'gzip B': f.gzip })),
    ...Object.entries(others).map(([file, gzip]) => ({ file: `${file} (committed)`, 'raw B': null, 'gzip B': gzip })),
  ])
  console.log(`Total gzip: ${totalGzip} B (budget ${GZIP_BUDGET_BYTES} B)`)
  console.log(`route/transfers.json: ${transfers.raw} B raw, ${transfers.gzip} B gzip (cap ${TRANSFERS_GZIP_CAP_BYTES} B, outside the budget)`)
  console.table(timetableFiles.map((f) => ({ file: `timetable/${f.name}`, 'raw B': f.raw, 'gzip B': f.gzip, 'cap B': TIMETABLE_FILE_GZIP_CAP_BYTES })))
  console.log(regular.stats)
  console.log(regular.skipped)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
