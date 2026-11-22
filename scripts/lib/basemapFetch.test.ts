import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MARKER, byteLimit, ensureTiles } from './basemapFetch.ts'
import type { EnsureDeps } from './basemapFetch.ts'
import { releaseAssetUrl, releaseTag } from './basemapSpec.ts'
import type { BasemapPin } from './basemapSpec.ts'
import { unpackTarGz } from './basemapUnpack.ts'
import { makeTarGz, tileBody } from './tarFixture.ts'
import type { FixtureEntry } from './tarFixture.ts'

const entries: FixtureEntry[] = [
  { name: 'tiles/0/0/0.mvt', body: tileBody(3) },
  { name: 'tiles/15/9649/12314.mvt', body: tileBody(700) },
]
const tarball = makeTarGz(entries)
const sha256 = createHash('sha256').update(tarball).digest('hex')
const pin: BasemapPin = {
  build: '20261121',
  basemapVersion: '4.15.2',
  release: releaseTag('20261121', sha256),
  asset: 'nyc-tiles.tar.gz',
  sha256,
  bytes: tarball.length,
  files: 2,
  tileBytes: 5 + 703,
}
const url = releaseAssetUrl(pin)
const expect2 = { files: 2, tileBytes: 708, maxZoom: 15 }

let dir: string
let out: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basemap-'))
  out = join(dir, 'basemap')
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

describe('ensureTiles', () => {
  it('downloads and unpacks once, then makes no request while the tree matches (offline after one fetch)', async () => {
    const deps = serving(tarball)
    expect((await ensureTiles(pin, url, out, 15, deps)).status).toBe('downloaded')
    expect(await readFile(join(out, 'tiles/15/9649/12314.mvt'))).toEqual(Buffer.from(tileBody(700)))
    expect((await ensureTiles(pin, url, out, 15, deps)).status).toBe('present')
    expect(deps.calls).toEqual([url])
    expect((await readdir(out)).sort()).toEqual([MARKER, 'tiles'])
  })

  it('fetches again when a tile was removed, added or edited, or the marker is stale', async () => {
    const deps = serving(tarball)
    await ensureTiles(pin, url, out, 15, deps)
    await rm(join(out, 'tiles/0/0/0.mvt'))
    expect((await ensureTiles(pin, url, out, 15, deps)).status).toBe('downloaded')
    await writeFile(join(out, 'tiles/0/0/1.mvt'), tileBody())
    expect((await ensureTiles(pin, url, out, 15, deps)).status).toBe('downloaded')
    await writeFile(join(out, MARKER), 'old\n')
    expect((await ensureTiles(pin, url, out, 15, deps)).status).toBe('downloaded')
    expect(deps.calls).toHaveLength(4)
    expect(await readdir(join(out, 'tiles/0/0'))).toEqual(['0.mvt'])
  })

  it('refuses a download with the wrong hash or size and keeps nothing', async () => {
    const wrong = Buffer.alloc(tarball.length, 2)
    await expect(ensureTiles(pin, url, out, 15, serving(wrong))).rejects.toThrow(/does not match the pin.*sha256/)
    await expect(ensureTiles(pin, url, out, 15, serving(tarball.subarray(0, 4)))).rejects.toThrow(/4 bytes/)
    expect(await readdir(out)).toEqual([])
  })

  it('refuses a tarball whose sha256 the pin names but whose tile counts differ, and keeps nothing', async () => {
    await expect(ensureTiles({ ...pin, files: 3 }, url, out, 15, serving(tarball))).rejects.toThrow(/2 tile files, the pin says 3/)
    expect(await readdir(out)).toEqual([])
  })

  it('passes a failed download on and leaves nothing', async () => {
    const failing: EnsureDeps = {
      async download(_u, to) {
        await writeFile(to, 'half')
        throw new Error('HTTP 404')
      },
    }
    await expect(ensureTiles(pin, url, out, 15, failing)).rejects.toThrow('HTTP 404')
    expect(await readdir(out)).toEqual([])
  })
})

describe('unpackTarGz', () => {
  const unpack = async (list: FixtureEntry[], expect: Partial<typeof expect2> = {}) => {
    const file = join(dir, 'in.tar.gz')
    await writeFile(file, makeTarGz(list))
    return unpackTarGz(file, join(dir, 'dest'), { ...expect2, ...expect })
  }

  it('writes the tile files and reports the counts', async () => {
    expect(await unpack(entries)).toEqual({ files: 2, bytes: 708 })
    expect(await readdir(join(dir, 'dest/tiles/15/9649'))).toEqual(['12314.mvt'])
  })

  it('writes nothing when any entry is hostile, even a late one', async () => {
    const hostile = [...entries, { name: '/tmp/underground-escape.mvt', body: tileBody() }]
    await expect(unpack(hostile, { files: 3, tileBytes: 713 })).rejects.toThrow(/tar entry/)
    await expect(unpack([...entries, { name: 'tiles/1/0/0.mvt', type: '2', link: '../../../escape' }], { files: 3, tileBytes: 708 })).rejects.toThrow(/symlinks|regular file/)
    await expect(readdir(join(dir, 'dest'))).rejects.toThrow(/ENOENT/)
  })

  it('refuses counts, sizes and bodies that are not the pin\'s, and gzip bombs', async () => {
    await expect(unpack(entries, { files: 3 })).rejects.toThrow(/2 tile files, the pin says 3/)
    await expect(unpack(entries, { tileBytes: 700 })).rejects.toThrow(/at most|total 708/)
    await expect(unpack([{ name: 'tiles/0/0/0.mvt', body: Uint8Array.from([0x1f, 0x8b, 8]) }], { files: 1, tileBytes: 3 })).rejects.toThrow(/not an MVT/)
    const file = join(dir, 'bomb.tar.gz')
    await writeFile(file, makeTarGz([{ name: 'tiles/0/0/0.mvt', body: tileBody(100) }, { name: 'tiles/1/0/0.mvt', body: tileBody(100) }]))
    await expect(unpackTarGz(file, join(dir, 'dest2'), { files: 1, tileBytes: 10, maxZoom: 15 })).rejects.toThrow(/at most/)
    await expect(readdir(join(dir, 'dest2'))).rejects.toThrow(/ENOENT/)
  })

  it('does not follow a symlink already at the destination', async () => {
    await mkdir(join(dir, 'dest'), { recursive: true })
    await mkdir(join(dir, 'elsewhere'))
    await symlink(join(dir, 'elsewhere'), join(dir, 'dest/tiles'))
    await expect(unpack(entries)).rejects.toThrow(/already exists/)
    expect(await readdir(join(dir, 'elsewhere'))).toEqual([])
  })
})
