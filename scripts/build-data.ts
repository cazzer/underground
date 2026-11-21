/** Builds public/data/*.json from the regular MTA static GTFS zip. The only file here that does IO.
 *
 *  npm run data                      download https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
 *  npm run data -- --zip path.zip    use a local zip (the regular feed; the supplemented feed is unsupported)
 *  GTFS_ZIP=path.zip npm run data    same, via the environment (the flag wins)
 *
 *  Everything is built in memory first; nothing is written if a build step throws or the
 *  gzipped total is over budget. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { readFeed } from './lib/gtfs.ts'
import { buildRoutes, buildStations, buildTransfers } from './lib/network.ts'
import { buildSegments } from './lib/segments.ts'
import { buildShapes } from './lib/shapes.ts'
import { toStableJson } from './lib/stableJson.ts'
import { buildTripIndex } from './lib/tripIndex.ts'

const FEED_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip'
const OUT_DIR = new URL('../public/data/', import.meta.url)
const SIMPLIFY_TOLERANCE_M = 3
const GZIP_BUDGET_BYTES = 60_000
const NEEDED = new Set(
  ['stops', 'routes', 'trips', 'stop_times', 'shapes', 'transfers', 'calendar', 'calendar_dates', 'feed_info'].map(
    (name) => `${name}.txt`,
  ),
)

async function loadZip(zipPath: string | undefined): Promise<Uint8Array> {
  if (zipPath) {
    console.log(`Reading ${zipPath}`)
    return readFileSync(zipPath)
  }
  console.log(`Downloading ${FEED_URL}`)
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  console.log(`Downloaded ${bytes.length} bytes, Last-Modified: ${res.headers.get('last-modified') ?? 'unknown'}`)
  return bytes
}

function decodeTables(zip: Uint8Array): Record<string, string> {
  const files = unzipSync(zip, { filter: (f) => NEEDED.has(f.name) })
  const missing = [...NEEDED].filter((name) => !(name in files))
  if (missing.length > 0) throw new Error(`Zip is missing ${missing.join(', ')}`)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, decoder.decode(bytes)]))
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { zip: { type: 'string' } }, strict: true })
  const feed = readFeed(decodeTables(await loadZip(values.zip ?? process.env.GTFS_ZIP)))
  const { feedVersion } = feed
  console.log(`Feed version: ${feedVersion}`)

  const { segments, skipped: skippedSegments } = buildSegments(feed.stopTimes)
  const { file: tripIndex, skippedNoShape } = buildTripIndex(feed)
  const outputs: [string, unknown, number][] = [
    ['stations.json', { feedVersion, stations: buildStations(feed) }, 2],
    ['routes.json', { feedVersion, routes: buildRoutes(feed) }, 2],
    ['shapes.json', { feedVersion, shapes: buildShapes(feed, SIMPLIFY_TOLERANCE_M) }, 2],
    ['segments.json', { feedVersion, segments }, 2],
    ['transfers.json', { feedVersion, transfers: buildTransfers(feed) }, 2],
    ['trip-index.json', { feedVersion, ...tripIndex }, 3],
  ]

  const rendered = outputs.map(([name, value, lineDepth]) => {
    const text = toStableJson(value, lineDepth)
    return { name, text, raw: Buffer.byteLength(text), gzip: gzipSync(text, { level: 9 }).length }
  })
  const totalGzip = rendered.reduce((sum, f) => sum + f.gzip, 0)
  if (totalGzip > GZIP_BUDGET_BYTES) {
    const sizes = rendered.map((f) => `${f.name} ${f.gzip}`).join(', ')
    throw new Error(`Gzipped total ${totalGzip} B is over the ${GZIP_BUDGET_BYTES} B budget (${sizes}). Nothing written.`)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  for (const f of rendered) writeFileSync(new URL(f.name, OUT_DIR), f.text)

  console.table(rendered.map((f) => ({ file: f.name, 'raw B': f.raw, 'gzip B': f.gzip })))
  console.log(`Total gzip: ${totalGzip} B (budget ${GZIP_BUDGET_BYTES} B)`)
  console.log(`Skipped: ${skippedSegments} non-positive segment samples, ${skippedNoShape} trips without a shape`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
