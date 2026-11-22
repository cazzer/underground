/** Checks that the live site serves the basemap tiles; the deploy workflow runs it after Pages published them.
 *
 *  node scripts/verify-basemap.ts <tiles-base-url> '<probe-sizes-json>' [--attempts N] [--delay-s S]
 *
 *  Uses the network (the URL given, nothing else). `<probe-sizes-json>` is `node scripts/basemap-tiles.ts probe-sizes
 *  dist/basemap/tiles`: the file size of each probe tile in the deployed tree (scripts/lib/tileProbe.ts: z0, a z15 tile over
 *  Midtown and one over Brooklyn). Each is fetched twice, with `Accept-Encoding: identity` and with a browser's header
 *  (`gzip, deflate, br`: a browser also offers zstd, which Node cannot decode; a script can set the header, a page's JavaScript
 *  cannot), and must answer 200 with a body that,
 *  decoded, is a valid MVT of exactly the file's size and (when compressed) the identity bytes. Pages may compress the
 *  tile; the browser decodes that transparently, so a content-encoding is recorded, never a failure. A tile the pack does not
 *  hold is also asked for: its status (the client treats 404 as an empty tile) is recorded, not judged.
 *  A new deploy can take a moment to reach the CDN, so it retries (default 6 times, 20 s apart, none starting after 12
 *  minutes), each time with a cache-busting query. Every header, content-type and content-encoding included, goes to the job summary. */
import { appendFileSync } from 'node:fs'
import { MISSING_TILE, PROBE_TILES, tilePath, tileProblems } from './lib/tileProbe.ts'
import type { ProbeResponse, ProbeTile } from './lib/tileProbe.ts'

/** A request that hangs is cut off at 30 s, and no new attempt starts after 12 minutes, so the worst case (a last attempt of
 *  seven slow requests) ends well inside the job's 20-minute timeout and the summary is always written. */
const REQUEST_TIMEOUT_MS = 30_000
const DEADLINE_MS = 12 * 60_000

type Encoding = 'identity' | 'browser'

/** What a browser sends on an ordinary request, less zstd: Node's fetch cannot decode a zstd body, so offering it would
 *  turn a server that answers zstd into a false failure (Pages answers gzip, as measured). */
const BROWSER_ENCODINGS = 'gzip, deflate, br'
const SHOWN = ['content-type', 'content-encoding', 'content-length', 'cache-control', 'etag', 'vary', 'age', 'x-cache']

interface Probe {
  tile: ProbeTile
  encoding: Encoding
  response?: ProbeResponse
  problems: string[]
}

async function request(base: string, tile: ProbeTile, encoding: Encoding): Promise<ProbeResponse> {
  const target = new URL(`${base.replace(/\/$/, '')}/${tilePath(tile)}`)
  target.searchParams.set('cb', `${Date.now()}`)
  const res = await fetch(target, {
    headers: { 'Accept-Encoding': encoding === 'browser' ? BROWSER_ENCODINGS : 'identity', 'User-Agent': 'underground-basemap-verify/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  // fetch decodes a gzip, deflate or br body, as a browser does: this is the body the client would read.
  return { status: res.status, headers: Object.fromEntries(res.headers), body: new Uint8Array(await res.arrayBuffer()) }
}

async function runAll(base: string, sizes: Record<string, number>): Promise<Probe[]> {
  const probes: Probe[] = []
  for (const tile of PROBE_TILES) {
    const size = sizes[tilePath(tile)] as number
    let reference: Uint8Array | undefined
    for (const encoding of ['identity', 'browser'] as const) {
      const probe: Probe = { tile, encoding, problems: [] }
      try {
        probe.response = await request(base, tile, encoding)
        probe.problems = tileProblems({ size, encoding: encoding === 'identity' ? 'identity' : 'any', reference }, probe.response)
        if (encoding === 'identity' && probe.problems.length === 0) reference = probe.response.body
      } catch (err) {
        probe.problems = [`request failed: ${err instanceof Error ? err.message : String(err)}`]
      }
      probes.push(probe)
    }
  }
  return probes
}

async function absentTile(base: string): Promise<Probe> {
  const probe: Probe = { tile: MISSING_TILE, encoding: 'identity', problems: [] }
  try {
    probe.response = await request(base, MISSING_TILE, 'identity')
  } catch (err) {
    probe.problems = [`request failed: ${err instanceof Error ? err.message : String(err)}`]
  }
  return probe
}

function summary(base: string, probes: Probe[]): string {
  const rows = probes.map((p) => {
    const h = p.response?.headers ?? {}
    const headers = SHOWN.filter((k) => h[k] !== undefined).map((k) => `${k}: ${h[k]}`).join('<br>')
    const result = p.tile === MISSING_TILE ? 'recorded (the client treats 404 as an empty tile)' : p.problems.join('; ') || 'ok'
    return `| ${p.tile.label} (${tilePath(p.tile)}) | ${p.encoding} | ${p.response?.status ?? 'none'} | ${p.response?.body?.length ?? '-'} | ${headers || '-'} | ${result} |`
  })
  return ['### Basemap tile check', base, '', '| Tile | Accept-Encoding | Status | Decoded bytes | Headers | Result |', '|---|---|---|---|---|---|', ...rows, ''].join('\n')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function option(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  const n = Number(args[i + 1])
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number`)
  return n
}

function parseSizes(json: string): Record<string, number> {
  const sizes = JSON.parse(json) as Record<string, unknown>
  for (const tile of PROBE_TILES) {
    const size = sizes[tilePath(tile)]
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) throw new Error(`the sizes JSON has no size for the probe tile ${tilePath(tile)}`)
  }
  return sizes as Record<string, number>
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const [base, sizesJson] = args
  if (base === undefined || sizesJson === undefined) throw new Error("usage: node scripts/verify-basemap.ts <tiles-base-url> '<probe-sizes-json>' [--attempts N] [--delay-s S]")
  const sizes = parseSizes(sizesJson)
  const attempts = option(args, '--attempts', 6)
  const delayS = option(args, '--delay-s', 20)

  const deadline = Date.now() + DEADLINE_MS
  let probes: Probe[] = []
  for (let attempt = 1; attempt <= attempts; attempt++) {
    probes = await runAll(base, sizes)
    if (probes.every((p) => p.problems.length === 0)) break
    for (const p of probes) for (const problem of p.problems) console.log(`attempt ${attempt}/${attempts}: ${p.tile.label} (${p.encoding}): ${problem}`)
    if (attempt < attempts) {
      if (Date.now() + delayS * 1000 > deadline) {
        console.log('The 12-minute deadline is near: no further attempts.')
        break
      }
      await sleep(delayS * 1000)
    }
  }
  const text = summary(base, [...probes, await absentTile(base)])
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)

  const failed = probes.flatMap((p) => p.problems.map((problem) => `${p.tile.label} (${p.encoding}): ${problem}`))
  if (failed.length > 0) throw new Error(`the site does not serve the basemap tiles correctly:\n- ${failed.join('\n- ')}`)
  console.log('The site serves the basemap tiles as 200 MVT bodies of the right size, with and without compression.')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
