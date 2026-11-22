import { describe, expect, it } from 'vitest'
import { probeRanges, rangeProblems } from './rangeProbe.ts'
import type { ProbeResponse } from './rangeProbe.ts'

const total = 33_000_000
const head = { start: 0, end: 126 }
const tail = { start: total - 127, end: total - 1 }
const header = Uint8Array.from([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3, ...new Array<number>(119).fill(0)])

function ok(range: { start: number; end: number }, body: Uint8Array): ProbeResponse {
  return { status: 206, headers: { 'content-range': `bytes ${range.start}-${range.end}/${total}`, 'content-length': String(body.length) }, body }
}

describe('probeRanges', () => {
  it('asks for the first and the last 127 bytes', () => {
    expect(probeRanges(total)).toEqual([head, tail])
  })

  it('refuses a file too small to probe', () => {
    expect(() => probeRanges(10)).toThrow(/too small/)
  })
})

describe('rangeProblems', () => {
  it('passes a correct uncompressed 206 at the start and at the end', () => {
    expect(rangeProblems(head, total, ok(head, header))).toEqual([])
    expect(rangeProblems(tail, total, ok(tail, new Uint8Array(127)))).toEqual([])
  })

  it('fails a 200 that sends the whole file', () => {
    const res: ProbeResponse = { status: 200, headers: { 'content-length': String(total) }, body: new Uint8Array(total) }
    const problems = rangeProblems(head, total, res)
    expect(problems.join()).toMatch(/status 200, not 206/)
    expect(problems.join()).toMatch(/content-range missing/)
    expect(problems.join()).toMatch(/body is 33000000 bytes/)
  })

  it('fails a gzipped range, whose content-range total Pages gets wrong', () => {
    const res: ProbeResponse = { status: 206, headers: { 'content-range': 'bytes 0-126/20', 'content-encoding': 'gzip' } }
    const problems = rangeProblems(head, total, res)
    expect(problems.join()).toMatch(/content-range "bytes 0-126\/20"/)
    expect(problems.join()).toMatch(/content-encoding gzip/)
  })

  it('accepts an explicit identity encoding', () => {
    const res = ok(head, header)
    expect(rangeProblems(head, total, { ...res, headers: { ...res.headers, 'content-encoding': 'identity' } })).toEqual([])
  })

  it('fails a body that is not a PMTiles v3 header', () => {
    expect(rangeProblems(head, total, ok(head, new Uint8Array(127))).join()).toMatch(/start with "PMTiles"/)
    const v2 = Uint8Array.from(header)
    v2[7] = 2
    expect(rangeProblems(head, total, ok(head, v2)).join()).toMatch(/spec version 2/)
  })

  it('does not check the magic at the end of the file, or a body it was not given', () => {
    expect(rangeProblems(tail, total, ok(tail, new Uint8Array(127)))).toEqual([])
    const { body: _body, ...noBody } = ok(head, header)
    expect(rangeProblems(head, total, noBody)).toEqual([])
  })

  it('fails a wrong-length body', () => {
    expect(rangeProblems(tail, total, ok(tail, new Uint8Array(100))).join()).toMatch(/body is 100 bytes, not 127/)
  })
})
