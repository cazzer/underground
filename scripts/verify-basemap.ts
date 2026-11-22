/** Measures HTTP Range on a served basemap file; the deploy workflow runs it against the live Pages site.
 *
 *  node scripts/verify-basemap.ts <file-url> <bytes> [--attempts N] [--delay-s S]
 *
 *  Uses the network (the URL given, nothing else). For the first and last 127 bytes it asks with
 *  `Accept-Encoding: identity` and fails unless the answer is a correct uncompressed 206 (scripts/lib/rangeProbe.ts);
 *  a new deploy can take a moment to reach the CDN, so it retries (default 6 times, 20 s apart), each time with a
 *  cache-busting query. It then asks again with `Accept-Encoding: gzip`: Pages gzips that range with a wrong
 *  content-range total, so a difference is reported as a warning, not a failure (clients that send gzip, such as
 *  Firefox before 148, then misread the archive). Every header goes to the job summary. */
import { appendFileSync } from 'node:fs'
import { probeRanges, rangeProblems } from './lib/rangeProbe.ts'
import type { ByteRange, ProbeResponse } from './lib/rangeProbe.ts'

const REQUEST_TIMEOUT_MS = 60_000

interface Probe {
  label: string
  encoding: 'identity' | 'gzip'
  range: ByteRange
  response?: ProbeResponse
  problems: string[]
}

async function request(url: string, range: ByteRange, encoding: 'identity' | 'gzip'): Promise<ProbeResponse> {
  const target = new URL(url)
  target.searchParams.set('cb', `${Date.now()}`)
  const res = await fetch(target, {
    headers: { Range: `bytes=${range.start}-${range.end}`, 'Accept-Encoding': encoding, 'User-Agent': 'underground-basemap-verify/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const headers = Object.fromEntries(res.headers)
  if (encoding === 'gzip') {
    await res.body?.cancel()
    return { status: res.status, headers }
  }
  return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) }
}

async function run(url: string, total: number, encoding: 'identity' | 'gzip'): Promise<Probe[]> {
  const probes: Probe[] = []
  for (const range of probeRanges(total)) {
    const probe: Probe = { label: `${encoding} bytes=${range.start}-${range.end}`, encoding, range, problems: [] }
    try {
      probe.response = await request(url, range, encoding)
      probe.problems = rangeProblems(range, total, probe.response)
    } catch (err) {
      probe.problems = [`request failed: ${err instanceof Error ? err.message : String(err)}`]
    }
    probes.push(probe)
  }
  return probes
}

function summary(url: string, total: number, probes: Probe[]): string {
  const rows = probes.map((p) => {
    const h = p.response?.headers ?? {}
    const shown = ['content-range', 'content-length', 'content-encoding', 'content-type', 'cache-control', 'etag', 'accept-ranges', 'age', 'x-cache']
    const headers = shown.filter((k) => h[k] !== undefined).map((k) => `${k}: ${h[k]}`).join('<br>')
    return `| ${p.label} | ${p.response?.status ?? 'none'} | ${headers || '-'} | ${p.problems.join('; ') || 'ok'} |`
  })
  return [`### Basemap Range check`, `${url} (${total} bytes)`, '', '| Request | Status | Headers | Result |', '|---|---|---|---|', ...rows, ''].join('\n')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function option(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  const n = Number(args[i + 1])
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number`)
  return n
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const [url, bytes] = args
  if (url === undefined || bytes === undefined) throw new Error('usage: node scripts/verify-basemap.ts <file-url> <bytes> [--attempts N] [--delay-s S]')
  const total = Number(bytes)
  if (!Number.isInteger(total) || total <= 0) throw new Error(`bytes must be a positive integer, got ${bytes}`)
  const attempts = option(args, '--attempts', 6)
  const delayS = option(args, '--delay-s', 20)

  let identity: Probe[] = []
  for (let attempt = 1; attempt <= attempts; attempt++) {
    identity = await run(url, total, 'identity')
    if (identity.every((p) => p.problems.length === 0)) break
    for (const p of identity) for (const problem of p.problems) console.log(`attempt ${attempt}/${attempts}: ${p.label}: ${problem}`)
    if (attempt < attempts) await sleep(delayS * 1000)
  }
  const gzip = await run(url, total, 'gzip')
  const text = summary(url, total, [...identity, ...gzip])
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)

  for (const p of gzip) {
    if (p.problems.length > 0) console.log(`::warning::${p.label}: ${p.problems.join('; ')}. A client that sends Accept-Encoding: gzip will misread the archive; the headers are in the job summary.`)
  }
  const failed = identity.flatMap((p) => p.problems.map((problem) => `${p.label}: ${problem}`))
  if (failed.length > 0) throw new Error(`the site does not serve the basemap with correct Range responses:\n- ${failed.join('\n- ')}`)
  console.log('The site serves the basemap with correct uncompressed 206 Range responses.')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
