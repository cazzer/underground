/** How many tracks a station has and where they run, from the cross-sections.
 *  One v-window covers every platform at every cut (their outermost edges plus a margin), so platforms of
 *  different length or stagger do not change which tracks count. A 4-track station with side platforms
 *  counts the express tracks between them, which no platform touches. */
import type { Section, SectionInterval } from './crossSection.ts'

const MARGIN_M = 5

export interface TrackSpan {
  count: number
  /** Sorted v of each track: the median, across the cuts that agree on the count, of the track at that rank. */
  offsets: number[]
  /** Largest range, across those cuts, of any one track's v. A straight station has almost none. */
  spreadM: number
}

/** `keep` says which intervals belong to platforms in the layout; a stray polygon must not widen the window. */
export function trackSpan(sections: Section[], keep: (iv: SectionInterval) => boolean): TrackSpan {
  const kept = sections.map((s) => ({ ...s, intervals: s.intervals.filter(keep) }))
  const withPlatforms = kept.filter((s) => s.intervals.length > 0)
  if (withPlatforms.length === 0) return { count: 0, offsets: [], spreadM: 0 }
  const lo = Math.min(...withPlatforms.flatMap((s) => s.intervals.map((i) => i.v0))) - MARGIN_M
  const hi = Math.max(...withPlatforms.flatMap((s) => s.intervals.map((i) => i.v1))) + MARGIN_M
  const lists = withPlatforms.map((s) => s.crossings.filter((c) => c.v >= lo && c.v <= hi).map((c) => c.v))
  const counts = lists.map((l) => l.length).sort((a, b) => a - b)
  const count = counts[(counts.length - 1) >> 1]!
  const agreeing = lists.filter((l) => l.length === count)
  const offsets: number[] = []
  let spreadM = 0
  for (let rank = 0; rank < count; rank++) {
    const vs = agreeing.map((l) => l[rank]!).sort((a, b) => a - b)
    offsets.push(vs[(vs.length - 1) >> 1]!)
    spreadM = Math.max(spreadM, vs[vs.length - 1]! - vs[0]!)
  }
  return { count, offsets, spreadM }
}
