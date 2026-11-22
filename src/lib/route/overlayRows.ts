/** A realtime trip's predictions as a row on a scheduled stop sequence. Pure; times are seconds since the day start. */
import type { Arrival } from '../../data/realtime'
import type { Row } from './overlayGroups'
import type { StopIndex } from './types'

/** A predicted run that stops this far (s) before the horizon would have shown the next stop is a short turn,
 *  not a horizon cut: the Worker keeps a stop if its time is within the horizon, so slack covers rounding. */
export const CUT_SLACK_S = 60

export interface PredictedRun {
  /** Stop indices of the arrivals the index knows, in feed order. */
  stops: Int32Array
  /** Predicted time at each, as a non-decreasing run. */
  times: Int32Array
  /** A time was raised to stay in order. */
  clamped: boolean
  /** Arrivals at stops the index lacks. */
  dropped: number
}

/** The feed's arrivals as stop indices and day seconds: unknown stops dropped, times kept non-decreasing. */
export function predictedRun(arrivals: readonly Arrival[], index: StopIndex, dayStartS: number): PredictedRun {
  const stops: number[] = []
  const times: number[] = []
  let clamped = false
  let dropped = 0
  let last = -Infinity
  for (const [stopId, epoch] of arrivals) {
    const stop = index.stopOf.get(stopId)
    if (stop === undefined) {
      dropped += 1
      continue
    }
    let t = Math.round(epoch - dayStartS)
    if (t < last) {
      t = last
      clamped = true
    }
    last = t
    stops.push(stop)
    times.push(t)
  }
  return { stops: Int32Array.from(stops), times: Int32Array.from(times), clamped, dropped }
}

/** First position in `stops` where `run` appears as consecutive stops (every occurrence of its first stop is
 *  tried, for loops that call at a stop twice), else -1. */
export function findRun(stops: Int32Array, run: Int32Array): number {
  if (run.length === 0) return -1
  for (let j = 0; j + run.length <= stops.length; j++) {
    if (stops[j] !== run[0]) continue
    let i = 1
    while (i < run.length && stops[j + i] === run[i]) i++
    if (i === run.length) return j
  }
  return -1
}

/** The unremoved row whose arrival at position `j0` is nearest `t0`; the first of equals. */
export function nearestRow(rows: readonly Row[], j0: number, t0: number): Row | null {
  let best: Row | null = null
  let bestGap = Infinity
  for (const row of rows) {
    if (row.removed) continue
    const gap = Math.abs(row.arr[j0]! - t0)
    if (gap < bestGap) {
      best = row
      bestGap = gap
    }
  }
  return best
}

export interface RowBounds {
  /** Now, in day seconds. */
  nowDay: number
  /** The last time the feed's predictions reach, in day seconds. */
  horizonDay: number
}

export interface RowTimes {
  arr: Int32Array
  dep: Int32Array
  /** The tail after the last prediction is scheduled run times. */
  extended: boolean
}

/**
 * A realtime trip on a scheduled stop sequence of `n` stops, its run at positions `j0` on, taking the dwells and
 * run times it has no prediction for from `ref`, a scheduled row of the same sequence. Predicted stops have
 * arr = dep. Before the run the times follow `ref` shifted onto the first prediction but never later than one
 * second before now (a passed stop is not boardable). After it they continue the same way only when the
 * predictions stop at the horizon; a run that ends earlier is a short turn, and null.
 */
export function rowOnPattern(
  n: number,
  j0: number,
  run: Pick<PredictedRun, 'stops' | 'times'>,
  ref: Pick<Row, 'arr' | 'dep'>,
  bounds: RowBounds,
): RowTimes | null {
  const j1 = j0 + run.stops.length - 1
  const t = run.times
  const arr = new Int32Array(n)
  const dep = new Int32Array(n)

  const shift0 = t[0]! - ref.arr[j0]!
  const passed = Math.min(bounds.nowDay - 1, t[0]!)
  for (let i = 0; i < j0; i++) {
    arr[i] = Math.min(ref.arr[i]! + shift0, passed)
    dep[i] = Math.min(ref.dep[i]! + shift0, passed)
  }
  for (let k = 0; k < run.stops.length; k++) {
    arr[j0 + k] = t[k]!
    dep[j0 + k] = t[k]!
  }

  if (j1 === n - 1) return { arr, dep, extended: false }
  const last = t[t.length - 1]!
  const next = last + (ref.arr[j1 + 1]! - ref.arr[j1]!)
  if (next <= bounds.horizonDay - CUT_SLACK_S) return null
  const shift1 = last - ref.arr[j1]!
  for (let i = j1 + 1; i < n; i++) {
    arr[i] = ref.arr[i]! + shift1
    dep[i] = ref.dep[i]! + shift1
  }
  return { arr, dep, extended: true }
}
