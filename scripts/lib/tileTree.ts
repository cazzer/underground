/** Reads a directory of basemap tiles (`<dir>/<z>/<x>/<y>.mvt`): the counts the pin records, and whether every file is a
 *  tile it should be. The same code runs in the basemap workflow (before packing), in the deploy (after extracting) and
 *  in the dev fetch (is the tree already there). */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PROBE_TILES, mvtProblems, tilePath } from './tileProbe.ts'
import { tileNameProblem } from './tarTiles.ts'

export interface TreeScan {
  files: number
  /** The sum of the tile files' sizes. */
  bytes: number
  byZoom: Record<number, { files: number; bytes: number }>
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

/** Walks `dir`. Every entry must be a regular file named `<z>/<x>/<y>.mvt` on its zoom's grid (at most `maxZoom`); with
 *  `verify`, every file is also read and must be an MVT (scripts/lib/tileProbe.ts). A missing directory is one problem. */
export async function scanTiles(dir: string, { verify = false, maxZoom = 15 }: { verify?: boolean; maxZoom?: number } = {}): Promise<TreeScan> {
  const scan: TreeScan = { files: 0, bytes: 0, byZoom: {}, problems: [], moreProblems: 0 }
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
      const zoom = (scan.byZoom[z] ??= { files: 0, bytes: 0 })
      zoom.files++
      zoom.bytes += size
      scan.files++
      scan.bytes += size
      if (verify) for (const p of mvtProblems(await readFile(f.path))) report(`${f.rel}: ${p}`)
    }
  }
  return scan
}

/** The sizes of the probe tiles in the tree, keyed by `<z>/<x>/<y>.mvt`. Throws when one is missing: the deploy would probe a 404. */
export async function probeSizes(dir: string): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {}
  for (const tile of PROBE_TILES) {
    const rel = tilePath(tile)
    try {
      sizes[rel] = (await stat(join(dir, rel))).size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`the probe tile ${tile.label} (${rel}) is not in ${dir}`)
      throw err
    }
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
