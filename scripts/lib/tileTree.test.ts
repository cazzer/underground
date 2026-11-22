import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gzipTileBody, tileBody } from './tarFixture.ts'
import { PROBE_TILES, tilePath } from './tileProbe.ts'
import { probeSizes, scanProblems, scanTiles, treeEncoding } from './tileTree.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tiletree-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

async function put(rel: string, body: Uint8Array = tileBody()): Promise<void> {
  await mkdir(join(dir, rel, '..'), { recursive: true })
  await writeFile(join(dir, rel), body)
}

describe('scanTiles', () => {
  it('counts files and bytes, in total and per zoom', async () => {
    await put('0/0/0.mvt', tileBody(3))
    await put('15/9649/12314.mvt', tileBody(10))
    await put('15/9649/12315.mvt', tileBody(10))
    const scan = await scanTiles(dir, { verify: true })
    expect(scan).toMatchObject({ files: 3, bytes: 5 + 12 + 12, gzipFiles: 0, inflatedBytes: 29, problems: [], moreProblems: 0 })
    expect(scan.byZoom).toEqual({ 0: { files: 1, bytes: 5, inflatedBytes: 5 }, 15: { files: 2, bytes: 24, inflatedBytes: 24 } })
    expect(scanProblems(scan, { files: 3, tileBytes: 29 })).toEqual([])
    expect(scanProblems(scan, { files: 4, tileBytes: 30 })).toEqual(['3 tile files, the pin says 4', '29 tile bytes, the pin says 30'])
  })

  it('reports a stray name, a symlink, a bad body, a deep zoom and a missing dir', async () => {
    await put('0/0/0.mvt')
    await put('0/0/0.pbf')
    await put('16/0/0.mvt')
    await put('1/0/0.mvt', Uint8Array.from([0x1f, 0x8b, 8, 0]))
    await symlink(join(dir, '0/0/0.mvt'), join(dir, '0/0/1.mvt'))
    const scan = await scanTiles(dir, { verify: true, maxZoom: 15 })
    expect(scan.files).toBe(2)
    expect(scan.problems).toHaveLength(5)
    expect(scan.problems.join('\n')).toMatch(/0\.pbf.*not tiles/)
    expect(scan.problems.join('\n')).toMatch(/zoom 16 is over 15/)
    expect(scan.problems.join('\n')).toMatch(/1\/0\/0\.mvt: bad gzip stream/)
    expect(scan.problems.join('\n')).toMatch(/1 of 2 tiles are gzip and the rest plain/)
    expect(scan.problems.join('\n')).toMatch(/1\.mvt: not a regular file/)
    expect((await scanTiles(join(dir, 'nope'))).problems).toEqual([expect.stringMatching(/does not exist/)])
  })

  it('counts a gzip tree by stored and inflated bytes, and refuses a mixed or (when asked) plain tree', async () => {
    const big = gzipTileBody(600)
    await put('0/0/0.mvt', gzipTileBody(3))
    await put('15/9649/12314.mvt', big)
    const scan = await scanTiles(dir, { verify: true, gzip: true })
    expect(scan.problems).toEqual([])
    expect(scan).toMatchObject({ files: 2, gzipFiles: 2, bytes: gzipTileBody(3).length + big.length, inflatedBytes: 5 + 603 })
    expect(scan.byZoom[15]).toEqual({ files: 1, bytes: big.length, inflatedBytes: 603 })
    await put('15/9649/12315.mvt', tileBody(10))
    expect((await scanTiles(dir, { verify: true })).problems).toEqual(['2 of 3 tiles are gzip and the rest plain: a tree is all one or the other'])
    expect((await scanTiles(dir, { verify: true, gzip: true })).problems.join('\n')).toMatch(/12315\.mvt: not gzip-compressed/)
  })

  it('reports a corrupt gzip tile by name', async () => {
    const gz = gzipTileBody(300)
    await put('0/0/0.mvt', gz.subarray(0, gz.length - 12))
    const scan = await scanTiles(dir, { verify: true })
    expect(scan.problems).toEqual([expect.stringMatching(/^tiles\/0\/0\/0\.mvt: bad gzip stream/)])
  })

  it('does not read the bodies unless asked', async () => {
    await put('0/0/0.mvt', Uint8Array.from([0, 0, 0]))
    expect((await scanTiles(dir)).problems).toEqual([])
    expect((await scanTiles(dir, { verify: true })).problems).toHaveLength(1)
  })
})

describe('probeSizes', () => {
  it('sizes the probe tiles and names a missing one', async () => {
    const [first, ...others] = PROBE_TILES
    await put(tilePath(first!), tileBody(4))
    await expect(probeSizes(dir)).rejects.toThrow(/z15 Midtown/)
    for (const t of others) await put(tilePath(t), tileBody(8))
    expect(await probeSizes(dir)).toEqual({
      [tilePath(first!)]: { stored: 6, inflated: 6, gzip: false },
      [tilePath(others[0]!)]: { stored: 10, inflated: 10, gzip: false },
      [tilePath(others[1]!)]: { stored: 10, inflated: 10, gzip: false },
    })
  })

  it('records the stored and inflated size of gzip probe tiles, and refuses one that is not a tile', async () => {
    const gz = gzipTileBody(500)
    for (const t of PROBE_TILES) await put(tilePath(t), gz)
    const sizes = await probeSizes(dir)
    expect(sizes[tilePath(PROBE_TILES[1]!)]).toEqual({ stored: gz.length, inflated: 503, gzip: true })
    await put(tilePath(PROBE_TILES[0]!), gz.subarray(0, 20))
    await expect(probeSizes(dir)).rejects.toThrow(/z0 world.*bad gzip stream/)
  })
})

describe('treeEncoding', () => {
  it('names an empty, plain, gzip and mixed tree', () => {
    expect(treeEncoding({ files: 0, gzipFiles: 0 })).toBe('none')
    expect(treeEncoding({ files: 3, gzipFiles: 0 })).toBe('plain')
    expect(treeEncoding({ files: 3, gzipFiles: 3 })).toBe('gzip')
    expect(treeEncoding({ files: 3, gzipFiles: 1 })).toBe('mixed')
  })

  it('agrees with a scan of real trees', async () => {
    expect(treeEncoding(await scanTiles(dir, { verify: true }))).toBe('none')
    await put('0/0/0.mvt', gzipTileBody(3))
    expect(treeEncoding(await scanTiles(dir, { verify: true }))).toBe('gzip')
    await put('1/0/0.mvt', tileBody(3))
    expect(treeEncoding(await scanTiles(dir, { verify: true }))).toBe('mixed')
  })
})
