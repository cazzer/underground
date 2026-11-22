import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodeTile, isMvtBytes } from './decodeTile'
import { MAX_INFLATED_BYTES, inflateIfGzip, isGzip } from './inflate'
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
    expect(decodeTile(out, 15, 9647, 12320, ['roads'], null).path).toHaveLength(6)
  })

  it('passes raw MVT and empty bodies through as they are', async () => {
    expect(await inflateIfGzip(raw)).toBe(raw)
    const none = new Uint8Array()
    expect(await inflateIfGzip(none)).toBe(none)
  })

  it('hands the worker the same tile decoded whether it is stored plain or gzipped, as tiles are during the switch', async () => {
    const gz = gzipSync(raw, { level: 9, mtime: 0 })
    const plain = decodeTile(await inflateIfGzip(raw), 15, 9647, 12320, ['roads'], null)
    const fromGzip = decodeTile(await inflateIfGzip(gz), 15, 9647, 12320, ['roads'], null)
    expect(fromGzip).toEqual(plain)
    expect(fromGzip.path).toHaveLength(6)
  })

  it('leaves a gzip of a non-tile (a 404 page stored as .mvt) for the MVT check to refuse', async () => {
    const html = gzipSync(new TextEncoder().encode('<!doctype html><title>404</title>'))
    const out = await inflateIfGzip(html)
    expect(isMvtBytes(out)).toBe(false)
  })

  it('inflates a multi-chunk tile exactly, and rejects one that inflates past the cap', async () => {
    const big = new Uint8Array(MAX_INFLATED_BYTES).map((_, i) => (i * 31) % 251)
    const out = await inflateIfGzip(gzipSync(big))
    expect(out.byteLength).toBe(big.byteLength)
    expect(out.every((v, i) => v === big[i])).toBe(true)
    await expect(inflateIfGzip(gzipSync(new Uint8Array(MAX_INFLATED_BYTES + 1)))).rejects.toThrow(`inflates past ${MAX_INFLATED_BYTES} bytes`)
  })

  it('rejects a corrupt gzip stream', async () => {
    const bad = gzipSync(raw).slice(0, 12)
    await expect(inflateIfGzip(bad)).rejects.toThrow()
  })
})
