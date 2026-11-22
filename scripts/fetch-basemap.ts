/** Fetches the pinned NYC basemap (data/basemap/basemap.json `pin`) from its GitHub Release.
 *
 *  npm run basemap:fetch [-- --out <path>]
 *
 *  Uses the network once (a public release asset; nothing about the user or a location is sent); after that the
 *  file at the path is reused while its size and sha256 match the pin, so dev is offline. The default path,
 *  public/basemap/nyc.pmtiles, is gitignored, and vite serves it at /underground/basemap/nyc.pmtiles. The deploy
 *  workflow runs it with --out dist/basemap/nyc.pmtiles. Fails clearly while the pin is null. */
import { createWriteStream, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { ensureBasemap } from './lib/basemapFetch.ts'
import { BASEMAP_ASSET, parseBasemapFile, releaseAssetUrl } from './lib/basemapSpec.ts'

const FILE = new URL('../data/basemap/basemap.json', import.meta.url)
const DEFAULT_OUT = fileURLToPath(new URL(`../public/basemap/${BASEMAP_ASSET}`, import.meta.url))
const TIMEOUT_MS = 600_000

async function download(url: string, toPath: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'underground-basemap-fetch/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok || res.body === null) throw new Error(`${url}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(toPath))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const at = args.indexOf('--out')
  let out = DEFAULT_OUT
  if (at >= 0) {
    const value = args[at + 1]
    if (value === undefined || value.startsWith('--')) throw new Error('--out needs a path')
    out = value
  }
  const { pin } = parseBasemapFile(JSON.parse(readFileSync(FILE, 'utf8')))
  if (pin === null) throw new Error('data/basemap/basemap.json has no pin yet: run the basemap workflow, then pin its release in a PR')
  const url = releaseAssetUrl(pin)
  const result = await ensureBasemap(pin, url, out, { download })
  console.log(`${result === 'present' ? 'Already at' : 'Downloaded to'} ${out} (${pin.bytes} bytes, ${pin.release}, sha256 ${pin.sha256.slice(0, 12)}...)`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
