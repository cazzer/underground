/** The basemap tile tree's checks, for the workflows (scripts/lib/tileTree.ts, basemapUnpack.ts).
 *
 *  node scripts/basemap-tiles.ts check <tiles-dir> [--files N --tile-bytes M] [--max-zoom Z]
 *      Walks the tree, reads every file and fails unless each is an MVT named <z>/<x>/<y>.mvt on its zoom's grid (and, when
 *      given, the count and total size are N and M). Prints the totals per zoom; with $GITHUB_OUTPUT set it writes
 *      `files=` and `tile_bytes=`.
 *  node scripts/basemap-tiles.ts unpack <tar.gz> <dest-dir> --files N --tile-bytes M [--max-zoom Z]
 *      The deploy's extraction, on a tarball at hand (the basemap workflow round-trips what it packed with it).
 *  node scripts/basemap-tiles.ts probe-sizes <tiles-dir>
 *      Prints the sizes of the tiles verify-basemap.ts probes as one line of JSON; fails if one is not in the tree.
 *
 *  Offline. */
import { appendFileSync } from 'node:fs'
import { unpackTarGz } from './lib/basemapUnpack.ts'
import { probeSizes, scanProblems, scanTiles } from './lib/tileTree.ts'

function option(args: string[], name: string): number | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const n = Number(args[i + 1])
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} needs a whole number`)
  return n
}

function require(value: number | undefined, name: string): number {
  if (value === undefined) throw new Error(`${name} is required`)
  return value
}

async function check(dir: string, args: string[]): Promise<void> {
  const scan = await scanTiles(dir, { verify: true, maxZoom: option(args, '--max-zoom') ?? 15 })
  const files = option(args, '--files')
  const tileBytes = option(args, '--tile-bytes')
  const problems = scanProblems(scan, { files: files ?? scan.files, tileBytes: tileBytes ?? scan.bytes })
  if (scan.files === 0) problems.push('no tile files')
  console.log(`${dir}: ${scan.files} tile files, ${scan.bytes} bytes`)
  for (const [z, v] of Object.entries(scan.byZoom)) console.log(`  z${z}: ${v.files} files, ${v.bytes} bytes`)
  if (problems.length > 0) throw new Error(`the tile tree is not what it should be:\n- ${problems.join('\n- ')}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `files=${scan.files}\ntile_bytes=${scan.bytes}\n`)
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const [first, second] = rest
  if (command === 'check' && first !== undefined) return check(first, rest)
  if (command === 'unpack' && first !== undefined && second !== undefined) {
    const result = await unpackTarGz(first, second, { files: require(option(rest, '--files'), '--files'), tileBytes: require(option(rest, '--tile-bytes'), '--tile-bytes'), maxZoom: option(rest, '--max-zoom') ?? 15 })
    console.log(`Unpacked ${result.files} files, ${result.bytes} tile bytes into ${second}/tiles`)
    return
  }
  if (command === 'probe-sizes' && first !== undefined) {
    console.log(JSON.stringify(await probeSizes(first)))
    return
  }
  throw new Error('usage: node scripts/basemap-tiles.ts check <dir> | unpack <tar.gz> <dest> | probe-sizes <dir> (see the file header for options)')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
