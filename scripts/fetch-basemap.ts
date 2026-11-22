/** Fetches the pinned NYC basemap tiles (data/basemap/basemap.json `pin`) from their GitHub Release.
 *
 *  npm run basemap:fetch [-- --out <dir>]
 *
 *  Uses the network once (a public release asset; nothing about the user or a location is sent). The asset is a tarball of
 *  uncompressed MVT tiles; it is sha256- and size-checked, every entry is checked against an allowlist of tile paths and
 *  the pin's file count and byte total (scripts/lib/basemapUnpack.ts), and the tree lands at `<dir>/tiles/<z>/<x>/<y>.mvt`.
 *  After that the tree is reused while it still matches the pin, so dev is offline. The default dir, public/basemap, is
 *  gitignored, and vite serves it at /underground/basemap/tiles/{z}/{x}/{y}.mvt. The deploy workflow runs it with
 *  --out dist/basemap and removes the `.tiles-sha256` marker. Fails clearly while the pin is null or the old `nyc.pmtiles`
 *  format. */
import { createWriteStream, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { byteLimit, ensureTiles } from './lib/basemapFetch.ts'
import { parseBasemapFile, releaseAssetUrl } from './lib/basemapSpec.ts'

const FILE = new URL('../data/basemap/basemap.json', import.meta.url)
const DEFAULT_OUT = fileURLToPath(new URL('../public/basemap', import.meta.url))
const TIMEOUT_MS = 600_000

async function download(url: string, toPath: string, maxBytes: number): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'underground-basemap-fetch/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok || res.body === null) throw new Error(`${url}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), byteLimit(maxBytes), createWriteStream(toPath))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const at = args.indexOf('--out')
  let out = DEFAULT_OUT
  if (at >= 0) {
    const value = args[at + 1]
    if (value === undefined || value.startsWith('--')) throw new Error('--out needs a directory')
    out = value
  }
  const { spec, pin } = parseBasemapFile(JSON.parse(readFileSync(FILE, 'utf8')))
  if (pin === null) throw new Error('data/basemap/basemap.json has no pin yet: run the basemap workflow, then pin its release in a PR')
  if ('legacy' in pin) throw new Error('data/basemap/basemap.json pins the old nyc.pmtiles release; run the basemap workflow again and pin the tile tarball it publishes')
  const result = await ensureTiles(pin, releaseAssetUrl(pin), out, spec.maxzoom, { download })
  const secs = (ms: number): string => (ms / 1000).toFixed(1)
  const how = result.status === 'present' ? 'Already at' : `Downloaded in ${secs(result.downloadMs)} s, unpacked in ${secs(result.extractMs)} s to`
  console.log(`${how} ${out}/tiles (${pin.files} files, ${pin.tileBytes} tile bytes; tarball ${pin.bytes} bytes, ${pin.release}, sha256 ${pin.sha256.slice(0, 12)}...)`)
  // A machine-readable line for the deploy's job summary.
  if (result.status === 'downloaded') console.log(`timing download_s=${secs(result.downloadMs)} extract_s=${secs(result.extractMs)}`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
