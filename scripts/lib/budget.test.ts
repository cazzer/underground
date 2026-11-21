import { describe, expect, it } from 'vitest'
import { checkIndexCap, INDEX_GZIP_CAP_BYTES, renderedFile } from './budget.ts'

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
