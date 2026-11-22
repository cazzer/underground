import { describe, expect, it } from 'vitest'
import type { EntranceText } from './entranceText'
import { entranceCountSpoken, entranceRows } from './entranceList'

function text(index: number, head: string, tail: string, o: Partial<EntranceText> = {}): EntranceText {
  return {
    index,
    x: 0,
    z: 0,
    head,
    tail,
    text: tail === '' ? head : `${head} · ${tail}`,
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

  it('keeps the count and text of a merged label', () => {
    const [row] = entranceRows([text(7, 'Broadway', 'west side', { count: 3 })])
    expect(row).toEqual({ key: '7', text: 'Broadway · west side', elevator: false, count: 3 })
  })

  it('does not mutate its input and handles none', () => {
    const input = [text(1, 'B', ''), text(0, 'A', '')]
    entranceRows(input)
    expect(input.map((t) => t.index)).toEqual([1, 0])
    expect(entranceRows([])).toEqual([])
  })
})

describe('entranceCountSpoken', () => {
  it('says nothing for one entrance', () => {
    expect(entranceCountSpoken(1)).toBe('')
    expect(entranceCountSpoken(2)).toBe('2 entrances')
  })
})
