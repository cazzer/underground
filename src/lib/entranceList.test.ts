import { describe, expect, it } from 'vitest'
import type { EntranceText } from './entranceText'
import { entranceCountSpoken, entranceRows, entranceTotal, glueStreetNumbers, NOWRAP_MAX, rowParts } from './entranceList'

function text(index: number, head: string, tail: string, o: Partial<EntranceText> = {}): EntranceText {
  return {
    index,
    x: 0,
    z: 0,
    head,
    tail,
    text: tail === '' ? head : `${head} · ${tail}`,
    spoken: tail === '' ? head : `${head}, ${tail}`,
    elevator: false,
    unique: true,
    keys: [],
    headHouse: 0,
    count: 1,
    ...o,
  }
}

describe('entranceRows', () => {
  it('puts elevators first, then orders by street, numbers naturally, then by the rest of the text', () => {
    const rows = entranceRows([
      text(0, 'Broadway & W 96 St', 'SW corner'),
      text(1, 'Broadway & W 9 St', 'NE corner'),
      text(2, 'Broadway & W 96 St', 'NE corner'),
      text(3, 'Amsterdam Av', 'exit only'),
      text(4, 'W 96 St', 'elevator', { elevator: true }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['4', '3', '1', '2', '0'])
  })

  it('says the spoken text with the count of a merged label', () => {
    const rows = entranceRows([text(7, 'Broadway', 'west side', { count: 3, spoken: 'Broadway, west side' }), text(8, 'Z', '')])
    expect(rows.map((r) => [r.spoken, r.count])).toEqual([
      ['Broadway, west side, 3 entrances', 3],
      ['Z', 1],
    ])
    expect(entranceTotal(rows)).toBe(4)
  })

  it('does not mutate its input and handles none', () => {
    const input = [text(1, 'B', ''), text(0, 'A', '')]
    entranceRows(input)
    expect(input.map((t) => t.index)).toEqual([1, 0])
    expect(entranceRows([])).toEqual([])
  })
})

describe('rowParts', () => {
  it('splits at the label’s separators and keeps a relation on the street part’s line', () => {
    expect(rowParts('Bedford Av & N 7 St', 'NE corner · elevator').map((p) => [p.sep, p.text])).toEqual([
      ['', 'Bedford Av & N 7 St'],
      [' · ', 'NE corner'],
      [' · ', 'elevator'],
    ])
    expect(rowParts('Broadway median', 'at W 95 St').map((p) => [p.sep, p.text])).toEqual([
      ['', 'Broadway median'],
      [' ', 'at W 95 St'],
    ])
    expect(rowParts('Broadway', '')).toEqual([{ sep: '', text: 'Broadway', keep: true }])
  })

  it('keeps a street number with its direction and type word', () => {
    expect(glueStreetNumbers('W 116 St & 7 Av')).toBe('W 116 St & 7 Av')
    expect(glueStreetNumbers('Broadway median')).toBe('Broadway median')
  })

  it('keeps a part whole with its dot only up to NOWRAP_MAX; a longer one may wrap between words', () => {
    const tail = `${'x'.repeat(NOWRAP_MAX - 2)} · ${'y'.repeat(NOWRAP_MAX - 1)}`
    const [a, b, c] = rowParts('Prospect Park W & 9 St', tail)
    expect([a!.keep, b!.keep, c!.keep]).toEqual([true, true, true])
    const long = rowParts('Prospect Park Southwest & Bartel Pritchard Sq', 'NE corner')
    expect(long[0]!.keep).toBe(false)
    expect(long[0]!.text).toContain(' ')
    expect(long[1]!.keep).toBe(true)
    expect(rowParts('Short', 'z'.repeat(NOWRAP_MAX - 1) + ' · b')[1]!.keep).toBe(false)
  })

  it('reads back as the label’s own text', () => {
    const joined = rowParts('7 Av', 'east side at W 42 St · exit only')
      .map((p) => p.sep + p.text)
      .join('')
    expect(joined.replaceAll('\u00a0', ' ')).toBe('7 Av · east side at W 42 St · exit only')
  })
})

describe('entranceCountSpoken', () => {
  it('says nothing for one entrance', () => {
    expect(entranceCountSpoken(1)).toBe('')
    expect(entranceCountSpoken(2)).toBe(', 2 entrances')
  })
})
