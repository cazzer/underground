/** The basemap tile tree's checks, for the workflows (scripts/lib/tileTree.ts, basemapUnpack.ts).
 *
 *  A tile file is a plain MVT or a gzip-compressed one (starts `1f 8b`; still named .mvt, and the pin's `tileBytes` counts
 *  the stored, compressed sizes); a gzip tile is inflated and the MVT inside checked. A tree is all one or the other.
 *
 *  node scripts/basemap-tiles.ts check <tiles-dir> [--files N --tile-bytes M] [--max-zoom Z] [--gzip]
 *      Walks the tree, reads every file and fails unless each is an MVT (inflated first when gzip) named <z>/<x>/<y>.mvt on
 *      its zoom's grid (and, when given, the count and total size are N and M; with --gzip, unless each is gzip). Prints the
 *      stored and inflated totals per zoom; with $GITHUB_OUTPUT set it writes `files=`, `tile_bytes=` (stored),
 *      `inflated_bytes=` and `encoding=` (`treeEncoding`: gzip or plain; a mixed or empty tree fails first).
 *  node scripts/basemap-tiles.ts unpack <tar.gz> <dest-dir> --files N --tile-bytes M [--max-zoom Z] [--gzip]
 *      The deploy's extraction, on a tarball at hand (the basemap workflow round-trips what it packed with it).
 *  node scripts/basemap-tiles.ts probe-sizes <tiles-dir>
 *      Prints the stored sizes of the tiles verify-basemap.ts probes as one line of JSON on stdout (what the site serves);
 *      a line per tile with stored and inflated sizes goes to stderr. Fails if one is not in the tree.
 *
 *  node scripts/basemap-tiles.ts pin-state
 *      Prints `none`, `legacy` (the old nyc.pmtiles pin) or `tiles` for data/basemap/basemap.json, which it validates
 *      with parseBasemapFile (so a malformed pin fails the deploy instead of being skipped).
 *
 *  Offline. */
import { appendFileSync, readFileSync } from 'node:fs'
import { parseBasemapFile } from './lib/basemapSpec.ts'
import { unpackTarGz } from './lib/basemapUnpack.ts'
import { probeSizes, scanProblems, scanTiles, treeEncoding } from './lib/tileTree.ts'

function option(args: string[], name: string): number | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  const n = value === undefined || value === '' ? NaN : Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} needs a whole number, got ${JSON.stringify(value ?? null)}`)
  return n
}

function required(value: number | undefined, name: string): number {
  if (value === undefined) throw new Error(`${name} is required`)
  return value
}

async function check(dir: string, args: string[]): Promise<void> {
  const scan = await scanTiles(dir, { verify: true, gzip: args.includes('--gzip'), maxZoom: option(args, '--max-zoom') ?? 15 })
  const files = option(args, '--files')
  const tileBytes = option(args, '--tile-bytes')
  const problems = scanProblems(scan, { files: files ?? scan.files, tileBytes: tileBytes ?? scan.bytes })
  if (scan.files === 0) problems.push('no tile files')
  const encoding = treeEncoding(scan)
  console.log(`${dir}: ${scan.files} tile files, ${scan.bytes} bytes stored (${encoding}), ${scan.inflatedBytes} bytes inflated`)
  for (const [z, v] of Object.entries(scan.byZoom)) console.log(`  z${z}: ${v.files} files, ${v.bytes} bytes stored, ${v.inflatedBytes} inflated`)
  if (problems.length > 0) throw new Error(`the tile tree is not what it should be:\n- ${problems.join('\n- ')}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `files=${scan.files}\ntile_bytes=${scan.bytes}\ninflated_bytes=${scan.inflatedBytes}\nencoding=${encoding}\n`)
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const [first, second] = rest
  if (command === 'check' && first !== undefined) return check(first, rest)
  if (command === 'unpack' && first !== undefined && second !== undefined) {
    const result = await unpackTarGz(first, second, { files: required(option(rest, '--files'), '--files'), tileBytes: required(option(rest, '--tile-bytes'), '--tile-bytes'), gzip: rest.includes('--gzip'), maxZoom: option(rest, '--max-zoom') ?? 15 })
    console.log(`Unpacked ${result.files} files, ${result.bytes} tile bytes into ${second}/tiles`)
    return
  }
  if (command === 'pin-state') {
    const { pin } = parseBasemapFile(JSON.parse(readFileSync(new URL('../data/basemap/basemap.json', import.meta.url), 'utf8')))
    console.log(pin === null ? 'none' : 'legacy' in pin ? 'legacy' : 'tiles')
    return
  }
  if (command === 'probe-sizes' && first !== undefined) {
    const sizes = await probeSizes(first)
    for (const [rel, s] of Object.entries(sizes)) console.error(`probe tile ${rel}: ${s.stored} B stored (${s.gzip ? 'gzip' : 'plain'}), ${s.inflated} B inflated`)
    console.log(JSON.stringify(Object.fromEntries(Object.entries(sizes).map(([rel, s]) => [rel, s.stored]))))
    return
  }
  throw new Error('usage: node scripts/basemap-tiles.ts check <dir> [--gzip] | unpack <tar.gz> <dest> [--gzip] | probe-sizes <dir> | pin-state (see the file header for options)')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
