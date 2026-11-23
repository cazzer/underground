import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { DownloadError, decodeTables, readCapped } from './feedZip.ts'

const stream = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })

describe('readCapped', () => {
  it('joins the chunks of a body under the cap', async () => {
    const res = new Response(stream([new Uint8Array([1, 2]), new Uint8Array([3])]))
    expect([...(await readCapped(res, 3))]).toEqual([1, 2, 3])
  })

  it('stops a streamed body that grows past the cap, whatever its headers say', async () => {
    const res = new Response(stream([new Uint8Array(4), new Uint8Array(4)]), { headers: { 'content-length': '2' } })
    await expect(readCapped(res, 6)).rejects.toThrow('over the 6 B cap')
  })

  it('refuses a stated Content-Length over the cap', async () => {
    const res = new Response(stream([new Uint8Array(1)]), { headers: { 'content-length': '100' } })
    await expect(readCapped(res, 10)).rejects.toThrow('100 bytes by its Content-Length')
  })
})

describe('download failures', () => {
  it('are DownloadErrors, so the deploy can tell an outage from a bug', async () => {
    const res = new Response(stream([new Uint8Array(4)]), { headers: { 'content-length': '100' } })
    await expect(readCapped(res, 10)).rejects.toBeInstanceOf(DownloadError)
  })
})

describe('decodeTables', () => {
  const text = new TextEncoder().encode('a,b\n')

  it('reads the needed tables, and throws on a missing one', () => {
    const zip = zipSync({ 'stops.txt': text })
    expect(() => decodeTables(zip, false)).toThrow('Zip is missing')
  })

  it('refuses an entry that inflates past the cap, and entries past the total', () => {
    const zip = zipSync({ 'stops.txt': new Uint8Array(1000), 'routes.txt': new Uint8Array(1000) })
    expect(() => decodeTables(zip, false, { entryBytes: 999 })).toThrow('inflates to 1000 bytes, over the 999 B cap')
    expect(() => decodeTables(zip, false, { totalBytes: 1500 })).toThrow('inflate to over 1500 bytes')
  })
})
