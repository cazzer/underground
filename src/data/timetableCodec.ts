/** Decoder for the trips of a timetable pattern. Pure. Explicit .ts imports (and no enums) so Node can run this file directly. */
import { TIMETABLE_UNIT_SEC, type TimetablePattern } from './timetableSchema.ts'

/** One trip's times in seconds after service-day midnight, one entry per stop of its pattern. */
export interface TripTimes {
  arrivals: number[]
  departures: number[]
}

/** Every trip of `pattern`, in file order. Throws on a malformed pattern (runs length, dwell pairs). */
export function decodePatternTimes(pattern: TimetablePattern): TripTimes[] {
  const label = `Pattern ${pattern.routeId} ${pattern.direction} ${pattern.stops[0] ?? ''}`
  const count = pattern.stops.length
  const out: TripTimes[] = []
  let dep0 = 0
  for (const [dep, runs, dwell = []] of pattern.trips) {
    if (runs.length !== count - 1) throw new Error(`${label}: ${runs.length} runs for ${count} stops`)
    if (dwell.length % 2 !== 0) throw new Error(`${label}: odd dwell length`)
    const dwellAt = new Map<number, number>()
    let last = -1
    for (let k = 0; k < dwell.length; k += 2) {
      const index = dwell[k]!
      if (!Number.isInteger(index) || index <= last || index >= count) throw new Error(`${label}: bad dwell index ${index}`)
      dwellAt.set(index, dwell[k + 1]!)
      last = index
    }
    dep0 += dep
    // Units until the end, so a sum never mixes seconds and units.
    const arrivals: number[] = []
    const departures: number[] = []
    for (let i = 0; i < count; i++) {
      const arrive = i === 0 ? dep0 - (dwellAt.get(0) ?? 0) : departures[i - 1]! + runs[i - 1]!
      arrivals.push(arrive)
      departures.push(arrive + (dwellAt.get(i) ?? 0))
    }
    out.push({
      arrivals: arrivals.map((u) => u * TIMETABLE_UNIT_SEC),
      departures: departures.map((u) => u * TIMETABLE_UNIT_SEC),
    })
  }
  return out
}
