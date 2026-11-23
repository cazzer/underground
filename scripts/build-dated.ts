/** Builds the dated (planned-work) timetables: <out>/<YYYYMMDD>.json plus <out>/index.json. Never committed: every Pages
 *  deploy runs it into dist/data/timetable/dated/ (.github/workflows/deploy.yml). The only file here that does IO.
 *
 *  npm run data:dated                       download both feeds, write public/data/timetable/dated/ (gitignored)
 *  npm run data:dated -- --out dir          write into `dir`, whose last path segment must be `dated`
 *  npm run data:dated -- --zip reg.zip --supplemented-zip supp.zip   local zips (each flag wins over GTFS_ZIP / GTFS_SUPPLEMENTED_ZIP)
 *  npm run data:dated -- --empty            write only an empty index (the deploy's fallback; reads and downloads nothing)
 *
 *  The dated files hold the supplemented feed's trips (the next seven days with planned work applied) on each date where
 *  it runs different trips than the regular feed (see lib/datedTimetable.ts and src/data/timetableSchema.ts). The
 *  baseline for "different" and the station changes come from the regular zip downloaded now; the stops they may call at
 *  come from the committed public/data/stations.json, so a stop it lacks fails the build. A regular feed_version that
 *  differs from the committed stations.json's is a WARNING (the files are then built against newer service days than
 *  the rest of the site; the daily refresh PR closes the gap).
 *
 *  Fails loudly: any problem throws (non-zero exit) and nothing is written. The deploy then runs `--empty`, so the site
 *  still ships and the client plans on the regular schedule. Files over the per-file or total cap fail the same way.
 *  Needs about 2 GB of memory with both zips in; the deploy gives node a 4 GB heap. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { StationsFile, StopId } from '../src/data/schema.ts'
import { EMPTY_DATED_INDEX, type StationChange } from '../src/data/timetableSchema.ts'
import { nyDate } from '../src/lib/realtime/serviceDate.ts'
import {
  TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES,
  TIMETABLE_FILE_GZIP_CAP_BYTES,
  checkDatedTimetableTotal,
  checkFileCap,
  renderedFile,
  type RenderedFile,
} from './lib/budget.ts'
import { buildDatedTimetables, serviceDays, type ServiceDays } from './lib/datedTimetable.ts'
import {
  FEED_URL,
  REGULAR_MAX_BYTES,
  SUPPLEMENTED_MAX_BYTES,
  SUPPLEMENTED_URL,
  decodeTables,
  loadZip,
  pruneJson,
} from './lib/feedZip.ts'
import { readFeed } from './lib/gtfs.ts'
import { toStableJson } from './lib/stableJson.ts'
import { buildStationChanges } from './lib/timetable.ts'

const DEFAULT_OUT = fileURLToPath(new URL('../public/data/timetable/dated/', import.meta.url))
const COMMITTED_STATIONS = new URL('../public/data/stations.json', import.meta.url)
const PRUNE_WHY = 'its date has no planned work now'

interface Baseline {
  feedVersion: string
  days: ServiceDays
  changes: readonly StationChange[]
}

/** What the regular zip gives the dated build; the feed itself goes out of scope here, so it can be collected before the
 *  supplemented zip is read. Shapes stay out (nothing here reads them, and they cost memory). */
function readBaseline(zip: Uint8Array): Baseline {
  const feed = readFeed(decodeTables(zip, false), { shapes: false })
  console.log(`Regular feed version: ${feed.feedVersion}`)
  return { feedVersion: feed.feedVersion, days: serviceDays(feed), changes: buildStationChanges(feed) }
}

/** The dated files and manifest, rendered, built from the supplemented zip against the regular baseline. */
function buildDated(zip: Uint8Array, baseline: Baseline, knownStops: ReadonlySet<StopId>) {
  const feed = readFeed(decodeTables(zip, false), { shapes: false })
  console.log(`Supplemented feed version: ${feed.feedVersion}`)
  if (feed.feedVersion !== baseline.feedVersion) {
    console.warn(
      `WARNING: the supplemented feed_version (${JSON.stringify(feed.feedVersion)}) differs from the regular one (${JSON.stringify(baseline.feedVersion)}); the two feeds may not match`,
    )
  }
  const built = buildDatedTimetables(feed, baseline.days, baseline.changes, knownStops)
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

/** `dir`'s *.json become exactly `written` (prune removes every other *.json there). */
function writeDir(dir: string, written: readonly RenderedFile[]): void {
  mkdirSync(dir, { recursive: true })
  for (const f of written) writeFileSync(join(dir, f.name), f.text)
  pruneJson(dir, new Set(written.map((f) => f.name)), 'timetable/dated/', PRUNE_WHY)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      zip: { type: 'string' },
      'supplemented-zip': { type: 'string' },
      empty: { type: 'boolean' },
    },
    strict: true,
  })
  const out = resolve(values.out ?? DEFAULT_OUT)
  // Writing prunes every other *.json in the folder, so refuse one that is not plainly the dated folder.
  if (basename(out) !== 'dated') throw new Error(`--out must end in a folder named "dated" (it deletes the other *.json in it), got ${out}`)

  if (values.empty) {
    const index = renderedFile('index.json', toStableJson(EMPTY_DATED_INDEX, 1))
    writeDir(out, [index])
    console.log(`Wrote an empty dated/index.json to ${out}`)
    return
  }

  const stations = JSON.parse(readFileSync(COMMITTED_STATIONS, 'utf8')) as StationsFile
  const knownStops = new Set<StopId>(stations.stations.flatMap((s) => s.stops))
  const baseline = readBaseline(await loadZip(values.zip ?? process.env.GTFS_ZIP, FEED_URL, REGULAR_MAX_BYTES))
  if (baseline.feedVersion !== stations.feedVersion) {
    console.warn(
      `WARNING: the regular feed_version (${JSON.stringify(baseline.feedVersion)}) differs from the committed stations.json's (${JSON.stringify(stations.feedVersion)}); the dated files are built against newer service days than the rest of the site`,
    )
  }
  const suppZip = await loadZip(values['supplemented-zip'] ?? process.env.GTFS_SUPPLEMENTED_ZIP, SUPPLEMENTED_URL, SUPPLEMENTED_MAX_BYTES)
  const dated = buildDated(suppZip, baseline, knownStops)

  for (const f of dated.files) checkFileCap(f, TIMETABLE_FILE_GZIP_CAP_BYTES)
  const totalGzip = checkDatedTimetableTotal(dated.files)
  const written: RenderedFile[] = [...dated.files, dated.index]
  writeDir(out, written)

  console.table(written.map((f) => ({ file: `timetable/dated/${f.name}`, 'raw B': f.raw, 'gzip B': f.gzip, 'cap B': TIMETABLE_FILE_GZIP_CAP_BYTES })))
  console.log(`${dated.summary}, ${totalGzip} B gzip (cap ${TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES} B)`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
