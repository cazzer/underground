import { describe, expect, it } from 'vitest'
import { transferPairStations, transferStationIds } from './transferPairs'

const leads = new Map([
  ['A1', 'A1'],
  ['A2', 'A1'],
  ['B1', 'B1'],
])
const leadOf = (id: string): string => leads.get(id) ?? id

describe('transferPairStations', () => {
  it('skips a link inside one complex', () => {
    expect(
      transferPairStations(
        [
          { from: 'A1', to: 'A2' },
          { from: 'A2', to: 'A1' },
        ],
        leadOf,
      ),
    ).toEqual([])
  })

  it('keeps a link between complexes once, whichever way the rows run, ids in order', () => {
    const pairs = transferPairStations(
      [
        { from: 'B1', to: 'A2' },
        { from: 'A2', to: 'B1' },
        { from: 'C9', to: 'B1' },
        { from: 'B1', to: 'C9' },
      ],
      leadOf,
    )
    expect(pairs).toEqual([
      ['A2', 'B1'],
      ['B1', 'C9'],
    ])
  })

  it('treats a station in no complex as its own', () => {
    expect(transferPairStations([{ from: 'X', to: 'Y' }], leadOf)).toEqual([['X', 'Y']])
    expect(transferPairStations([{ from: 'X', to: 'X' }], leadOf)).toEqual([])
  })
})

describe('transferStationIds', () => {
  it('lists every station of every pair once, sorted', () => {
    expect(
      transferStationIds([
        ['B1', 'C9'],
        ['A2', 'B1'],
      ]),
    ).toEqual(['A2', 'B1', 'C9'])
  })
})
