/** How many tracks a station has and where they run, from the cross-sections.
 *  One v-window covers every platform at every cut (their outermost edges plus a margin), so platforms of
 *  different length or stagger do not change which tracks count. A 4-track station with side platforms
 *  counts the express tracks between them, which no platform touches. Siding, spur and yard ways count only
 *  between the outermost platform edges. */
import type { Section, SectionInterval } from './crossSection.ts'

const MARGIN_M = 5

export interface TrackSpan {
  count: number
  /** Sorted v of each track: the median, across the cuts that agree on the count, of the track at that rank. */
  offsets: number[]
  /** Largest range, across those cuts, of any one track's v. A straight station has almost none. */
  spreadM: number
  /** Set when siding, spur and yard ways were left out because counting them would make more than 4 tracks. */
  note?: string
}

/** More than this many tracks has no template; layup and yard leads are then not tracks of the station. */
const MAX_TRACKS = 4

function summarize(lists: number[][]): TrackSpan {
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

/** `keep` says which intervals belong to platforms in the layout; a stray polygon must not widen the window. */
export function trackSpan(sections: Section[], keep: (iv: SectionInterval) => boolean): TrackSpan {
  const kept = sections.map((s) => ({ ...s, intervals: s.intervals.filter(keep) }))
  const withPlatforms = kept.filter((s) => s.intervals.length > 0)
  if (withPlatforms.length === 0) return { count: 0, offsets: [], spreadM: 0 }
  const lo = Math.min(...withPlatforms.flatMap((s) => s.intervals.map((i) => i.v0))) - MARGIN_M
  const hi = Math.max(...withPlatforms.flatMap((s) => s.intervals.map((i) => i.v1))) + MARGIN_M
  const innerLo = lo + MARGIN_M
  const innerHi = hi - MARGIN_M
  // Main-line tracks count out to the margin; siding, spur and yard ways only strictly between the
  // outermost platform edges, where an unused center track sits.
  const lists = (withService: boolean): number[][] =>
    withPlatforms.map((s) => s.crossings.filter((c) => (c.service ? withService && c.v > innerLo && c.v < innerHi : c.v >= lo && c.v <= hi)).map((c) => c.v))
  const full = summarize(lists(true))
  if (full.count <= MAX_TRACKS) return full
  const mainline = summarize(lists(false))
  if (mainline.count < 1 || mainline.count > MAX_TRACKS) return full
  return { ...mainline, note: `${full.count - mainline.count} siding, spur or yard ways between the platforms ignored: counting them gives ${full.count} tracks` }
}
