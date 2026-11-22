import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { byteLimit, ensureBasemap } from './basemapFetch.ts'
import type { EnsureDeps } from './basemapFetch.ts'
import { releaseAssetUrl, releaseTag } from './basemapSpec.ts'
import type { BasemapPin } from './basemapSpec.ts'

const body = Buffer.from('PMTiles\x03 pretend archive')
const sha256 = createHash('sha256').update(body).digest('hex')
const pin: BasemapPin = { build: '20261121', basemapVersion: '4.15.2', release: releaseTag('20261121', sha256), sha256, bytes: body.length }
const url = releaseAssetUrl(pin)

let dir: string
let out: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basemap-'))
  out = join(dir, 'basemap', 'nyc.pmtiles')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

function serving(content: Buffer): EnsureDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async download(u, to) {
      calls.push(u)
      await writeFile(to, content)
    },
  }
}

describe('byteLimit', () => {
  const sink = () => new Writable({ write: (_chunk, _encoding, done) => done() })
  const run = (chunks: Buffer[], max: number) => pipeline(Readable.from(chunks), byteLimit(max), sink())

  it('passes a body of exactly the limit', async () => {
    await expect(run([Buffer.alloc(5), Buffer.alloc(5)], 10)).resolves.toBeUndefined()
  })

  it('fails as soon as the body passes the limit', async () => {
    await expect(run([Buffer.alloc(6), Buffer.alloc(6), Buffer.alloc(6)], 10)).rejects.toThrow(/passed 10 bytes/)
  })
})

describe('ensureBasemap', () => {
  it('downloads once, then makes no request while the file matches (offline after one fetch)', async () => {
    const deps = serving(body)
    expect(await ensureBasemap(pin, url, out, deps)).toBe('downloaded')
    expect(await readFile(out)).toEqual(body)
    expect(await ensureBasemap(pin, url, out, deps)).toBe('present')
    expect(deps.calls).toEqual([url])
    expect(await readdir(join(dir, 'basemap'))).toEqual(['nyc.pmtiles'])
  })

  it('replaces a file that is stale or the wrong size', async () => {
    const deps = serving(body)
    await ensureBasemap(pin, url, out, deps)
    await writeFile(out, Buffer.alloc(body.length, 1))
    expect(await ensureBasemap(pin, url, out, deps)).toBe('downloaded')
    await writeFile(out, 'short')
    expect(await ensureBasemap(pin, url, out, deps)).toBe('downloaded')
    expect(await readFile(out)).toEqual(body)
  })

  it('refuses a download with the wrong hash and keeps nothing', async () => {
    const wrong = Buffer.alloc(body.length, 2)
    await expect(ensureBasemap(pin, url, out, serving(wrong))).rejects.toThrow(/does not match the pin.*sha256/)
    expect(await readdir(join(dir, 'basemap'))).toEqual([])
  })

  it('refuses a download of the wrong size', async () => {
    await expect(ensureBasemap(pin, url, out, serving(body.subarray(0, 4)))).rejects.toThrow(/4 bytes/)
  })

  it('passes a failed download on and leaves no partial file', async () => {
    const failing: EnsureDeps = {
      async download(_u, to) {
        await writeFile(to, 'half')
        throw new Error('HTTP 404')
      },
    }
    await expect(ensureBasemap(pin, url, out, failing)).rejects.toThrow('HTTP 404')
    expect(await readdir(join(dir, 'basemap'))).toEqual([])
  })
})
