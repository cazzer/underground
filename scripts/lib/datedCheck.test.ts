import { describe, expect, it } from 'vitest'
import { EMPTY_DATED_INDEX } from '../../src/data/timetableSchema.ts'
import { checkDatedOutputs, type DatedCheckKnown } from './datedCheck.ts'
import { regularFeed, supplementedFeed } from './datedFixture.ts'
import { buildDatedTimetables, serviceDays } from './datedTimetable.ts'
import { buildStationChanges } from './timetable.ts'

const known: DatedCheckKnown = {
  routeIds: new Set(regularFeed().routes.map((r) => r.id)),
  stops: new Set(regularFeed().stops.filter((s) => s.locationType === 0).map((s) => s.id)),
}
type Built = ReturnType<typeof built>
// A fresh build each call, so a test may change what it gets.
const built = () => buildDatedTimetables(supplementedFeed(), serviceDays(regularFeed()), buildStationChanges(regularFeed()), known.stops)
const check = (mutate: (b: Built) => void = () => {}, k: DatedCheckKnown = known) => {
  const b = built()
  mutate(b)
  checkDatedOutputs(b.files, b.index, k)
}
const twoTripPattern = (b: Built) => b.files[0]!.file.patterns.find((p) => p.trips.length >= 2)!

describe('checkDatedOutputs', () => {
  it('passes what the build makes, and an empty set', () => {
    expect(built().files.length).toBeGreaterThan(0)
    expect(() => check()).not.toThrow()
    expect(() => checkDatedOutputs([], { ...EMPTY_DATED_INDEX, dates: [] }, known)).not.toThrow()
  })

  it('throws on a route routes.json lacks', () => {
    expect(() => check(() => {}, { ...known, routeIds: new Set(['1']) })).toThrow(/route W is not in routes.json/)
  })

  it('throws on a stop stations.json lacks, or a station change for a station it lacks', () => {
    const stops = new Set([...known.stops].filter((s) => s !== 'B03S'))
    expect(() => check(() => {}, { ...known, stops })).toThrow(/stop B03S is not in stations.json/)
    expect(() => check((b) => b.files[0]!.file.changes.push({ station: 'ZZZ', minTransferSec: 60 }))).toThrow(/change for ZZZ/)
  })

  it('throws on a service id that is not a plain file name, or none', () => {
    expect(() => check((b) => b.files[0]!.file.services.push('../x'))).toThrow(/service id "..\/x" is not a plain id/)
    expect(() => check((b) => (b.files[0]!.file.services = []))).toThrow(/no active service/)
  })

  it('throws when the index and the files disagree', () => {
    expect(() => check((b) => b.index.dates.pop())).toThrow(/index lists/)
    expect(() => check((b) => (b.files[0]!.file.feedVersion = 'other'))).toThrow(/feedVersion "other"/)
    expect(() => check((b) => (b.files[0]!.file.date = '20200101'))).toThrow(/dated 20200101/)
  })

  it('throws on a date that is not real', () => {
    const b = built()
    b.index.dates = ['20261399']
    expect(() => checkDatedOutputs([{ date: '20261399', file: { ...b.files[0]!.file, date: '20261399' } }], b.index, known)).toThrow(/not a real date/)
  })

  it('throws on a trip that overtakes the one before it, and on a pattern that does not decode', () => {
    expect(() =>
      check((b) => {
        const p = twoTripPattern(b)
        p.trips[0] = [100, p.trips[0]![1].map(() => 5)]
        p.trips[1] = [0, p.trips[1]![1].map(() => 1)]
      }),
    ).toThrow(/trip 1 overtakes trip 0/)
    expect(() => check((b) => (b.files[0]!.file.patterns[0]!.trips[0] = [0, []]))).toThrow(/runs for/)
  })
})
