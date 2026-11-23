import { describe, expect, it } from 'vitest'
import { readCapped } from './feedZip.ts'

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
