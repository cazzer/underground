import { describe, expect, it } from 'vitest'
import { parseRise } from './riseParse.ts'

// Expected values are inches * 0.0254 computed by hand. Two entries in the brief's table disagreed
// with that arithmetic and are corrected here: 10' 11-3/8in is 131.375 in = 3.3369 m (brief: 3.3624)
// and 28 ' 9 3/16in is 345.1875 in = 8.7678 m (brief: 8.7836).
const GOOD: [string, number][] = [
  ["10' 11-3/8in", 3.3369],
  ["10' - 1 3/4in", 3.0925],
  ["10'- 1/2in", 3.0607],
  ["13'", 3.9624],
  ["13'2in", 4.0132],
  ['10’-11”', 3.3274],
  ['17’-3 ¼”', 5.2642],
  ['29.35 ft', 8.9459],
  ['30ft', 9.144],
  ['20 feet 8 1/4 inch', 6.3055],
  ["18'10 5/8", 5.7563],
  ['38-11 5/8in', 11.8777],
  ["19'=10in", 6.0452],
  ["23,519 mm (77' 1 15/16in)", 23.519],
  ["4362mm (14' 3-3/4in)", 4.362],
  ["28 ' 9 3/16in", 8.7678],
]
const BAD = ['14.8', '100', "40'39' 11 1/2in", "56' - 21.4in", '10in - 2 3/8in', '', "10' 3 5/4in", "10' 1/0in"]

describe('parseRise', () => {
  it.each(GOOD)('%s', (input, meters) => {
    const r = parseRise(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Math.abs(r.m - meters)).toBeLessThan(1.2e-4)
  })

  it.each(BAD)('rejects %j with a reason', (input) => {
    const r = parseRise(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })

  it('flags a metric value that disagrees with its imperial twin by more than 2%', () => {
    const r = parseRise("20000 mm (77' 1 15/16in)")
    expect(r).toMatchObject({ ok: true, m: 20 })
    expect(r.ok && r.warning).toMatch(/disagree/)
  })

  it('has no warning when metric and imperial agree', () => {
    const r = parseRise("23,519 mm (77' 1 15/16in)")
    expect(r.ok && r.warning).toBeFalsy()
  })
})
