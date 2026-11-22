import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodeTile, isMvtBytes } from './decodeTile'
import { inflateIfGzip, isGzip } from './inflate'
import { writeMvt } from './mvtFixture'

const raw = writeMvt([{ name: 'roads', features: [{ type: 2, props: { kind: 'path' }, parts: [[[10, 10], [500, 500]]] }] }])

describe('inflateIfGzip', () => {
  it('inflates a gzipped tile to the same MVT', async () => {
    const gz = gzipSync(raw)
    expect(isGzip(gz)).toBe(true)
    expect(isMvtBytes(gz)).toBe(false)
    const out = await inflateIfGzip(gz)
    expect([...out]).toEqual([...raw])
    expect(isMvtBytes(out)).toBe(true)
    expect(decodeTile(out, 15, 9647, 12320, ['roads']).path).toHaveLength(6)
  })

  it('passes raw MVT and empty bodies through as they are', async () => {
    expect(await inflateIfGzip(raw)).toBe(raw)
    const none = new Uint8Array()
    expect(await inflateIfGzip(none)).toBe(none)
  })

  it('rejects a corrupt gzip stream', async () => {
    const bad = gzipSync(raw).slice(0, 12)
    await expect(inflateIfGzip(bad)).rejects.toThrow()
  })
})
