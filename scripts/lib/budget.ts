/**
 * The gzip budget of the top-level public/data/*.json the client loads up front (GTFS files and
 * station-depths.json), shared by build-data.ts, build-access.ts and build-stations.ts: the one size limit.
 * Per-station interiors (public/data/stations/) load on focus and don't count.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

export const GZIP_BUDGET_BYTES = 60_000
/** stations/index.json loads after startup (not render-blocking), so it has its own cap outside the budget above. */
export const INDEX_GZIP_CAP_BYTES = 8_000
/** stations/depths-generated.json (generated stations' track depths) loads only under the TEMPORARY `?generated=1`
 *  for now, so it is outside the budget above, with its own cap. */
export const GENERATED_DEPTHS_GZIP_CAP_BYTES = 32_000

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
