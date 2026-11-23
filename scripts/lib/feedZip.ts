/** The MTA GTFS zips: where they live, a size-capped download, and the tables a build reads. Shared by
 *  scripts/build-data.ts (the regular zip) and scripts/build-dated.ts (both). IO only through `loadZip` and `pruneJson`. */
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'

export const FEED_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip'
export const SUPPLEMENTED_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip'
/** A download over its cap is refused before it is all held in memory: the regular zip is about 5.6 MB (fall 2026)... */
export const REGULAR_MAX_BYTES = 32 * 1024 * 1024
/** ...and the supplemented one about 19.5 MB. */
export const SUPPLEMENTED_MAX_BYTES = 64 * 1024 * 1024
/** A zip entry may inflate to this much (the biggest real one, stop_times.txt, is under 100 MB)... */
export const MAX_ENTRY_BYTES = 512 * 1024 * 1024
/** ...and the entries a build reads to this much together, so a zip bomb throws before it is inflated. */
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024

/** The exit code of a build whose download failed (network, HTTP status, timeout, byte cap): an MTA outage, not our bug. */
export const DOWNLOAD_EXIT_CODE = 3

/** A feed download that failed; scripts/build-dated.ts maps it to DOWNLOAD_EXIT_CODE so the deploy can tell it apart. */
export class DownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DownloadError'
  }
}

const DOWNLOAD_TIMEOUT_MS = 120_000

export const NEEDED = new Set(
  ['stops', 'routes', 'trips', 'stop_times', 'shapes', 'transfers', 'calendar', 'calendar_dates', 'feed_info'].map(
    (name) => `${name}.txt`,
  ),
)

/** Reads a response body, throwing as soon as it is over `maxBytes`: by Content-Length when the server states one, else
 *  by counting the stream, so a body that lies or has no length is cut off too. */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const stated = Number(res.headers.get('content-length'))
  if (Number.isFinite(stated) && stated > maxBytes) {
    await res.body?.cancel()
    throw new DownloadError(`The download is ${stated} bytes by its Content-Length, over the ${maxBytes} B cap`)
  }
  if (!res.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new DownloadError(`The download is over the ${maxBytes} B cap`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return bytes
}

/** A local zip (`zipPath`) or the download of `url`, which may not exceed `maxBytes`. */
export async function loadZip(zipPath: string | undefined, url: string, maxBytes: number): Promise<Uint8Array> {
  if (zipPath) {
    console.log(`Reading ${zipPath}`)
    return readFileSync(zipPath)
  }
  console.log(`Downloading ${url}`)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!res.ok) throw new DownloadError(`Download of ${url} failed: HTTP ${res.status} ${res.statusText}`)
    const bytes = await readCapped(res, maxBytes)
    console.log(`Downloaded ${bytes.length} bytes, Last-Modified: ${res.headers.get('last-modified') ?? 'unknown'}`)
    return bytes
  } catch (err) {
    if (err instanceof DownloadError) throw err
    throw new DownloadError(`Download of ${url} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

/** `shapes: false` leaves shapes.txt out (the dated build never reads shapes, and they cost memory); pass the same flag to readFeed. */
export function decodeTables(
  zip: Uint8Array,
  shapes = true,
  { entryBytes = MAX_ENTRY_BYTES, totalBytes = MAX_TOTAL_BYTES }: { entryBytes?: number; totalBytes?: number } = {},
): Record<string, string> {
  const needed = new Set([...NEEDED].filter((name) => shapes || name !== 'shapes.txt'))
  let total = 0
  const files = unzipSync(zip, {
    filter: (f) => {
      if (!needed.has(f.name)) return false
      if (f.originalSize > entryBytes) throw new Error(`Zip entry ${f.name} inflates to ${f.originalSize} bytes, over the ${entryBytes} B cap`)
      total += f.originalSize
      if (total > totalBytes) throw new Error(`The zip entries read inflate to over ${totalBytes} bytes`)
      return true
    },
  })
  const missing = [...needed].filter((name) => !(name in files))
  if (missing.length > 0) throw new Error(`Zip is missing ${missing.join(', ')}`)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, decoder.decode(bytes)]))
}

/** Replaces `dirPath`'s *.json with `written`, removing the rest (a stale file the feed no longer has); `label` names it in the log. */
export function pruneJson(dirPath: string, written: ReadonlySet<string>, label: string, why: string): void {
  for (const name of readdirSync(dirPath).sort()) {
    if (!name.endsWith('.json') || written.has(name)) continue
    rmSync(join(dirPath, name))
    console.log(`${label}${name}: removed (${why})`)
  }
}
