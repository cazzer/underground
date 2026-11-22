/** Reads a directory of basemap tiles (`<dir>/<z>/<x>/<y>.mvt`): the counts the pin records, and whether every file is a
 *  tile it should be. The same code runs in the basemap workflow (before packing), in the deploy (after extracting) and
 *  in the dev fetch (is the tree already there). A tile file is a plain MVT or a gzip of one (still named `.mvt`). */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PROBE_TILES, readTile, tilePath } from './tileProbe.ts'
import { tileNameProblem } from './tarTiles.ts'

export interface TreeScan {
  files: number
  /** The sum of the tile files' sizes as stored (gzip sizes when the tiles are gzipped); what the pin's `tileBytes` counts. */
  bytes: number
  /** With `verify`: how many files are gzip, and the sum of the tiles' inflated sizes (their stored size when plain). */
  gzipFiles: number
  inflatedBytes: number
  byZoom: Record<number, { files: number; bytes: number; inflatedBytes: number }>
  /** What is wrong, at most 20 (the rest are counted in `moreProblems`); empty when the tree is clean. */
  problems: string[]
  moreProblems: number
}

const MAX_REPORTED = 20

async function* walk(dir: string, rel: string): AsyncGenerator<{ path: string; rel: string; kind: 'file' | 'other' }> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const at = `${rel}/${entry.name}`
    if (entry.isDirectory()) yield* walk(path, at)
    else yield { path, rel: at, kind: entry.isFile() ? 'file' : 'other' }
  }
}

export interface ScanOptions {
  /** Read every file and require an MVT, plain or gzip (scripts/lib/tileProbe.ts `readTile`). */
  verify?: boolean
  /** With `verify`: refuse a plain file. */
  gzip?: boolean
  maxZoom?: number
}

/** Walks `dir`. Every entry must be a regular file named `<z>/<x>/<y>.mvt` on its zoom's grid (at most `maxZoom`); with
 *  `verify`, every file is also read and must be an MVT, plain or gzip, and a tree that mixes the two is a problem. A
 *  missing directory is one problem. */
export async function scanTiles(dir: string, { verify = false, gzip = false, maxZoom = 15 }: ScanOptions = {}): Promise<TreeScan> {
  const scan: TreeScan = { files: 0, bytes: 0, gzipFiles: 0, inflatedBytes: 0, byZoom: {}, problems: [], moreProblems: 0 }
  const report = (message: string): void => {
    if (scan.problems.length < MAX_REPORTED) scan.problems.push(message)
    else scan.moreProblems++
  }
  try {
    await stat(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...scan, problems: [`${dir} does not exist`] }
    throw err
  }
  for await (const f of walk(dir, 'tiles')) {
    const nameProblem = tileNameProblem(f.rel, maxZoom)
    if (f.kind === 'other') report(`${f.rel}: not a regular file`)
    else if (nameProblem !== null) report(nameProblem)
    else {
      const size = (await stat(f.path)).size
      const z = Number(f.rel.split('/')[1])
      const zoom = (scan.byZoom[z] ??= { files: 0, bytes: 0, inflatedBytes: 0 })
      zoom.files++
      zoom.bytes += size
      scan.files++
      scan.bytes += size
      if (verify) {
        const tile = readTile(await readFile(f.path), { requireGzip: gzip })
        for (const p of tile.problems) report(`${f.rel}: ${p}`)
        if (tile.gzip) scan.gzipFiles++
        const inflated = tile.mvt?.length ?? 0
        zoom.inflatedBytes += inflated
        scan.inflatedBytes += inflated
      }
    }
  }
  if (verify && scan.gzipFiles > 0 && scan.gzipFiles < scan.files) report(`${scan.gzipFiles} of ${scan.files} tiles are gzip and the rest plain: a tree is all one or the other`)
  return scan
}

export interface ProbeSize {
  /** The file's size as stored: what the site serves, since Pages adds no content-encoding to it. */
  stored: number
  /** Its size inflated (the same when plain). */
  inflated: number
  gzip: boolean
}

/** The sizes of the probe tiles in the tree, keyed by `<z>/<x>/<y>.mvt`. Throws when one is missing (the deploy would
 *  probe a 404) or is not a tile. */
export async function probeSizes(dir: string): Promise<Record<string, ProbeSize>> {
  const sizes: Record<string, ProbeSize> = {}
  for (const tile of PROBE_TILES) {
    const rel = tilePath(tile)
    let body: Uint8Array
    try {
      body = await readFile(join(dir, rel))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`the probe tile ${tile.label} (${rel}) is not in ${dir}`)
      throw err
    }
    const read = readTile(body)
    if (read.mvt === null || read.problems.length > 0) throw new Error(`the probe tile ${tile.label} (${rel}) is not a tile: ${read.problems[0] ?? 'unreadable'}`)
    sizes[rel] = { stored: body.length, inflated: read.mvt.length, gzip: read.gzip }
  }
  return sizes
}

/** Why `scan` is not the tree the pin describes: problems, or a file count or size other than the pin's. Empty when it is. */
export function scanProblems(scan: TreeScan, expected: { files: number; tileBytes: number }): string[] {
  const out = [...scan.problems]
  if (scan.moreProblems > 0) out.push(`...and ${scan.moreProblems} more`)
  if (scan.files !== expected.files) out.push(`${scan.files} tile files, the pin says ${expected.files}`)
  if (scan.bytes !== expected.tileBytes) out.push(`${scan.bytes} tile bytes, the pin says ${expected.tileBytes}`)
  return out
}
