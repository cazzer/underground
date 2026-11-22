import { describe, expect, it } from 'vitest'
import { checkFileCap, checkIndexCap, checkStreetsTotal, INDEX_GZIP_CAP_BYTES, renderedFile } from './budget.ts'

describe('checkIndexCap', () => {
  it('returns the gzip size of an index under the cap', () => {
    expect(checkIndexCap(renderedFile('index.json', '{"stations":{}}\n'))).toBeLessThan(INDEX_GZIP_CAP_BYTES)
  })

  it('throws when the index is over the cap', () => {
    // Distinct pseudo-random ids so gzip can't shrink it below the cap.
    const ids = Array.from({ length: 4000 }, (_, i) => `S${((i * 2654435761) % 4294967296).toString(36)}`)
    const big = JSON.stringify({ stations: Object.fromEntries(ids.map((id) => [id, { provenance: 'authored' }])) })
    expect(() => checkIndexCap(renderedFile('index.json', big))).toThrow(/over its 8000 B cap/)
  })
})

describe('street file caps', () => {
  const big = JSON.stringify(Array.from({ length: 3000 }, (_, i) => (i * 2654435761) % 4294967296))

  it('checkFileCap passes a file under its cap and names one over it', () => {
    expect(checkFileCap(renderedFile('T01.json', '{}\n'), 100)).toBeLessThan(100)
    expect(() => checkFileCap(renderedFile('T02.json', big), 100)).toThrow(/T02.json is \d+ B gzipped, over its 100 B cap/)
  })

  it('checkStreetsTotal sums the files and throws over the total cap', () => {
    const files = [renderedFile('a.json', big), renderedFile('b.json', big)]
    const total = checkStreetsTotal(files, 1_000_000)
    expect(total).toBe(files[0]!.gzip + files[1]!.gzip)
    expect(() => checkStreetsTotal(files, total - 1)).toThrow(/2 street files total/)
  })
})
