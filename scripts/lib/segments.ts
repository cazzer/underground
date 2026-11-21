import { segmentKey } from '../../src/data/codec.ts'
import { compareIds, groupByTrip, type StopTimeRow } from './gtfs.ts'

/** Median; an even count gives the mean of the middle two (not rounded). Throws on empty input. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of no values')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Median scheduled run time per consecutive stop pair: arrival at b minus departure at a.
 *  Samples of zero or less seconds are dropped and counted in `skipped`. */
export function buildSegments(stopTimes: readonly StopTimeRow[]): {
  segments: Record<string, number>
  skipped: number
} {
  const samples = new Map<string, number[]>()
  let skipped = 0
  for (const rows of groupByTrip(stopTimes).values()) {
    for (let i = 1; i < rows.length; i++) {
      const from = rows[i - 1]!
      const to = rows[i]!
      const run = to.arrival - from.departure
      if (run <= 0) {
        skipped++
        continue
      }
      const key = segmentKey(from.stopId, to.stopId)
      const list = samples.get(key)
      if (list) list.push(run)
      else samples.set(key, [run])
    }
  }
  const segments: Record<string, number> = {}
  for (const key of [...samples.keys()].sort(compareIds)) segments[key] = Math.round(median(samples.get(key)!))
  return { segments, skipped }
}
