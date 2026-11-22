import { describe, expect, it } from 'vitest'
import { makeTar, tileBody } from './tarFixture.ts'
import { listTarFiles, tileNameProblem } from './tarTiles.ts'

const good = [
  { name: 'tiles/0/0/0.mvt', body: tileBody(3) },
  { name: 'tiles/15/9651/12326.mvt', body: tileBody(700) },
]

describe('listTarFiles', () => {
  it('lists regular tile files with their sizes and offsets', () => {
    const tar = makeTar(good)
    const files = listTarFiles(tar)
    expect(files.map((f) => [f.name, f.size])).toEqual([
      ['tiles/0/0/0.mvt', 5],
      ['tiles/15/9651/12326.mvt', 703],
    ])
    const second = files[1]!
    expect(tar.subarray(second.offset, second.offset + second.size)).toEqual(tileBody(700))
  })

  it('accepts an empty archive', () => {
    expect(listTarFiles(makeTar([]))).toEqual([])
  })

  it.each([
    ['an absolute path', { name: '/etc/passwd' }],
    ['a path outside tiles/', { name: 'other/0/0/0.mvt' }],
    ['a .. segment', { name: 'tiles/../../x/0/0.mvt' }],
    ['a .. in place of a tile number', { name: 'tiles/15/../0.mvt' }],
    ['a backslash', { name: 'tiles\\0\\0\\0.mvt' }],
    ['a ./ prefix', { name: './tiles/0/0/0.mvt' }],
    ['an extra segment', { name: 'tiles/0/0/0/0.mvt' }],
    ['another extension', { name: 'tiles/0/0/0.pbf' }],
    ['leading zeros', { name: 'tiles/01/0/0.mvt' }],
    ['a tile outside its zoom grid', { name: 'tiles/2/4/0.mvt' }],
    ['a directory entry', { name: 'tiles/0/', type: '5' }],
    ['a symlink', { name: 'tiles/0/0/0.mvt', type: '2', link: '/etc/passwd' }],
    ['a hard link', { name: 'tiles/0/0/0.mvt', type: '1', link: 'tiles/1/0/0.mvt' }],
    ['a device', { name: 'tiles/0/0/0.mvt', type: '3' }],
    ['a pax header', { name: 'tiles/0/0/0.mvt', type: 'x' }],
    ['a GNU long name', { name: '././@LongLink', type: 'L' }],
    ['a name prefix', { name: '0.mvt', prefix: 'tiles/0/0' }],
    ['a link name on a regular file', { name: 'tiles/0/0/0.mvt', link: 'elsewhere' }],
    ['a header that is not ustar', { name: 'tiles/0/0/0.mvt', magic: 'none' as const }],
    ['a GNU-magic header', { name: 'tiles/0/0/0.mvt', magic: 'gnu' as const }],
  ])('rejects %s', (_what, entry) => {
    expect(() => listTarFiles(makeTar([entry]))).toThrow(/tar entry/)
  })

  it('rejects a hostile entry after good ones, and a duplicate', () => {
    expect(() => listTarFiles(makeTar([...good, { name: '/abs.mvt' }]))).toThrow(/abs\.mvt/)
    expect(() => listTarFiles(makeTar([good[0]!, good[0]!]))).toThrow(/appears twice/)
  })

  it('rejects a bad checksum, a missing end block, data past the end and truncated data', () => {
    const tar = makeTar(good)
    const corrupt = Uint8Array.from(tar)
    corrupt[10] = 0x41
    expect(() => listTarFiles(corrupt)).toThrow(/checksum/)
    expect(() => listTarFiles(makeTar(good, { end: false }))).toThrow(/no end-of-archive/)
    const trailing = Uint8Array.from([...tar, 1])
    expect(() => listTarFiles(trailing)).toThrow(/data after/)
    expect(() => listTarFiles(tar.subarray(0, 512 + 100))).toThrow(/runs past the end|truncated/)
  })

  it('applies the zoom limit', () => {
    expect(() => listTarFiles(makeTar([{ name: 'tiles/16/0/0.mvt' }]), 15)).toThrow(/zoom 16 is over 15/)
  })
})

describe('tileNameProblem', () => {
  it('accepts tile paths on the grid', () => {
    expect(tileNameProblem('tiles/15/32767/0.mvt')).toBeNull()
    expect(tileNameProblem('tiles/15/32768/0.mvt')).toMatch(/outside/)
  })
})
