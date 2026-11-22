import { describe, expect, it } from 'vitest'
import { dedupeEntrances, dedupeEquipment, sodaFilter } from './stationSources.ts'

describe('sodaFilter', () => {
  it('keeps a single value as the plain equality parameter', () => {
    expect(sodaFilter('gtfs_stop_id', 'L08')).toEqual({ gtfs_stop_id: 'L08' })
    expect(sodaFilter('gtfs_stop_id', ['L08'])).toEqual({ gtfs_stop_id: 'L08' })
  })
  it('turns several values into one $where in(...)', () => {
    expect(sodaFilter('station_mrn', ['1', '22'])).toEqual({ $where: "station_mrn in('1','22')" })
  })
  it.each([["a'b"], ['a b'], [''], ['a);drop']])('rejects %j', (bad) => {
    expect(() => sodaFilter('gtfs_stop_id', ['L08', bad])).toThrow(/not a plain id/)
  })
  it('rejects no values', () => {
    expect(() => sodaFilter('gtfs_stop_id', [])).toThrow(/no values/)
  })
})

describe('dedupeEntrances', () => {
  const row = { type: 'Stair', entry: true, exit: true, lat: 40.7, lon: -74 }
  it('drops exact duplicates only, keeping order', () => {
    const other = { ...row, exit: false }
    expect(dedupeEntrances([row, other, { ...row }])).toEqual([row, other])
  })
})

describe('dedupeEquipment', () => {
  const row = { code: 'EL1', kind: 'elevator' as const, lat: 40.7, lon: -74, serving: 'street to mezzanine' }
  it('keeps one row per code when the repeats are identical', () => {
    expect(dedupeEquipment([row, { ...row }, { ...row, code: 'EL2' }])).toEqual([row, { ...row, code: 'EL2' }])
  })
  it('throws when two rows for one code disagree', () => {
    expect(() => dedupeEquipment([row, { ...row, lat: 40.8 }])).toThrow(/EL1: two rows disagree/)
  })
})
