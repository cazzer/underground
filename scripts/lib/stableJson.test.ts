import { describe, expect, it } from 'vitest'
import { toStableJson } from './stableJson.ts'

const sample = {
  feedVersion: 'v1',
  items: [
    { id: 'a', xs: [1, 2, 3] },
    { id: 'b', xs: [] },
  ],
  map: { k1: 5, k2: 6 },
}

describe('toStableJson', () => {
  it('parses back to the input', () => {
    for (const depth of [0, 1, 2, 3]) {
      expect(JSON.parse(toStableJson(sample, depth))).toEqual(sample)
    }
  })
  it('is byte-identical across calls and ends with a newline', () => {
    expect(toStableJson(sample, 2)).toBe(toStableJson(sample, 2))
    expect(toStableJson(sample, 2).endsWith('}\n')).toBe(true)
  })
  it('puts one entry per line down to lineDepth and keeps primitive arrays inline', () => {
    expect(toStableJson(sample, 2).trimEnd().split('\n')).toEqual([
      '{',
      '  "feedVersion": "v1",',
      '  "items": [',
      '    {"id":"a","xs":[1,2,3]},',
      '    {"id":"b","xs":[]}',
      '  ],',
      '  "map": {',
      '    "k1": 5,',
      '    "k2": 6',
      '  }',
      '}',
    ])
  })
  it('expands deeper with a larger lineDepth', () => {
    const lines = toStableJson(sample, 3).trimEnd().split('\n')
    expect(lines).toContain('      "id": "a",')
    expect(lines).toContain('      "xs": [1,2,3]')
    expect(lines).toContain('    "k1": 5,')
    expect(toStableJson(sample, 2)).not.toContain('"id": "a"')
  })
  it('keeps key order as given', () => {
    expect(toStableJson({ b: 1, a: 2 }, 1)).toBe('{\n  "b": 1,\n  "a": 2\n}\n')
  })
})
