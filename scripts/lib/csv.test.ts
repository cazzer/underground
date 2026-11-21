import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.ts'

describe('parseCsv', () => {
  it('turns a header and rows into records', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n', 'f.txt', ['a'])).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })
  it('strips a BOM', () => {
    expect(parseCsv('﻿a,b\n1,2\n', 'f.txt', ['a'])).toEqual([{ a: '1', b: '2' }])
  })
  it('handles quoted commas, escaped quotes and embedded newlines', () => {
    const text = 'id,desc\nA,"x, ""y"" z"\nB,"two\nlines"\nC,plain\n'
    expect(parseCsv(text, 'f.txt', ['id'])).toEqual([
      { id: 'A', desc: 'x, "y" z' },
      { id: 'B', desc: 'two\nlines' },
      { id: 'C', desc: 'plain' },
    ])
  })
  it('accepts CRLF and LF, with no extra record for trailing newlines', () => {
    const expected = [{ a: '1', b: '2' }]
    expect(parseCsv('a,b\r\n1,2\r\n', 'f.txt', [])).toEqual(expected)
    expect(parseCsv('a,b\n1,2', 'f.txt', [])).toEqual(expected)
    expect(parseCsv('a,b\n1,2\n\n', 'f.txt', [])).toEqual(expected)
  })
  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b\n1,\n', 'f.txt', [])).toEqual([{ a: '1', b: '' }])
  })
  it('throws on a missing required column, naming file and column', () => {
    expect(() => parseCsv('a,b\n1,2\n', 'stops.txt', ['c'])).toThrow(/stops\.txt.*"c"/)
  })
  it('throws on a wrong field count with the line number', () => {
    expect(() => parseCsv('a,b\n1,2\n3\n', 'stops.txt', [])).toThrow(/stops\.txt:3/)
  })
  it('throws on an unterminated quote', () => {
    expect(() => parseCsv('a\n"oops\n', 'f.txt', [])).toThrow(/unterminated/)
  })
})
