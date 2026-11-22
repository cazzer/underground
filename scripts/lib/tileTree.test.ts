import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tileBody } from './tarFixture.ts'
import { PROBE_TILES, tilePath } from './tileProbe.ts'
import { probeSizes, scanProblems, scanTiles } from './tileTree.ts'

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
    expect(scan).toMatchObject({ files: 3, bytes: 5 + 12 + 12, problems: [], moreProblems: 0 })
    expect(scan.byZoom).toEqual({ 0: { files: 1, bytes: 5 }, 15: { files: 2, bytes: 24 } })
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
    expect(scan.problems).toHaveLength(4)
    expect(scan.problems.join('\n')).toMatch(/0\.pbf.*not tiles/)
    expect(scan.problems.join('\n')).toMatch(/zoom 16 is over 15/)
    expect(scan.problems.join('\n')).toMatch(/1\/0\/0\.mvt: byte 0 is 0x1f/)
    expect(scan.problems.join('\n')).toMatch(/1\.mvt: not a regular file/)
    expect((await scanTiles(join(dir, 'nope'))).problems).toEqual([expect.stringMatching(/does not exist/)])
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
    expect(await probeSizes(dir)).toEqual({ [tilePath(first!)]: 6, [tilePath(others[0]!)]: 10, [tilePath(others[1]!)]: 10 })
  })
})
