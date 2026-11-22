import type { StationId } from '../../data/schema'
import { journeys } from './journey'
import { stopsOfStations } from './stops'
import { NO_TIME, type Journey, type Labels, type Pattern, type RouteOptions, type Timetable } from './types'

const NO_POS = 0x7fffffff
export const DEFAULT_MAX_TRANSFERS = 4

/** Scratch state of one query. */
interface Work {
  /** Best arrival at a stop over every round so far. */
  bestArr: Int32Array
  readyMarked: Uint8Array
  arrMarked: Uint8Array
  firstPos: Int32Array
  targetBest: number
}

function allocLabels(rounds: number, nStops: number, departS: number): Labels {
  const size = (rounds + 1) * nStops
  return {
    rounds,
    nStops,
    departS,
    arrT: new Int32Array(size).fill(NO_TIME),
    arrPat: new Int32Array(size).fill(-1),
    arrTrip: new Int32Array(size).fill(-1),
    arrBoardPos: new Int32Array(size).fill(-1),
    readyT: new Int32Array(size).fill(NO_TIME),
    readyFrom: new Int32Array(size).fill(-1),
    readyRound: new Int32Array(size).fill(-1),
    targetS: new Int32Array(rounds + 1).fill(NO_TIME),
    targetStop: new Int32Array(rounds + 1).fill(-1),
    egressS: new Int32Array(nStops).fill(NO_TIME),
    egressTo: new Int32Array(nStops).fill(-1),
  }
}

/** Walking to a target stop: 0 at the target itself, else the footpath into a target in another station. */
function fillEgress(tt: Timetable, labels: Labels, toStops: Int32Array): void {
  const { footStart, footTo, footS, stationOfStop } = tt.stops
  const isTarget = new Uint8Array(labels.nStops)
  for (const q of toStops) {
    isTarget[q] = 1
    labels.egressS[q] = 0
  }
  for (let p = 0; p < labels.nStops; p++) {
    for (let e = footStart[p]!; e < footStart[p + 1]!; e++) {
      const q = footTo[e]!
      if (isTarget[q] && stationOfStop[q] !== stationOfStop[p] && footS[e]! < labels.egressS[p]!) {
        labels.egressS[p] = footS[e]!
        labels.egressTo[p] = q
      }
    }
  }
}

/** Round 0: every origin stop is ready at once, and the stops of other stations a transfer reaches after its walk. */
function seedRound(tt: Timetable, labels: Labels, work: Work, fromStops: Int32Array, toStops: Int32Array): void {
  const { footStart, footTo, footS } = tt.stops
  for (const s of fromStops) {
    labels.readyT[s] = labels.departS
    labels.readyRound[s] = 0
    work.readyMarked[s] = 1
  }
  for (const s of fromStops) {
    for (let e = footStart[s]!; e < footStart[s + 1]!; e++) {
      const q = footTo[e]!
      const t = labels.departS + footS[e]!
      if (t < labels.readyT[q]!) {
        labels.readyT[q] = t
        labels.readyFrom[q] = s
        labels.readyRound[q] = 0
        work.readyMarked[q] = 1
      }
    }
  }
  for (const q of toStops) {
    if (labels.readyT[q]! < work.targetBest) {
      work.targetBest = labels.readyT[q]!
      labels.targetS[0] = work.targetBest
      labels.targetStop[0] = q
    }
  }
}

/** First trip in [0, hi) departing position i at or after `ready`, or -1. Trips are FIFO, so dep is sorted. */
function earliestTrip(pat: Pattern, i: number, ready: number, hi: number): number {
  const n = pat.stops.length
  let lo = 0
  let top = hi
  while (lo < top) {
    const mid = (lo + top) >> 1
    if (pat.dep[mid * n + i]! >= ready) top = mid
    else lo = mid + 1
  }
  return lo < hi ? lo : -1
}

/** Round k: ride every pattern from the earliest stop whose ready time improved, labelling arrivals. */
function scanRound(tt: Timetable, labels: Labels, work: Work, k: number): boolean {
  const n = labels.nStops
  const base = k * n
  const prev = base - n
  let arrived = false
  work.firstPos.fill(NO_POS)
  for (let p = 0; p < n; p++) {
    if (!work.readyMarked[p]) continue
    work.readyMarked[p] = 0
    for (let e = tt.patStart[p]!; e < tt.patStart[p + 1]!; e++) {
      const pi = tt.patAt[e]!
      if (tt.patPos[e]! < work.firstPos[pi]!) work.firstPos[pi] = tt.patPos[e]!
    }
  }
  for (let pi = 0; pi < tt.patterns.length; pi++) {
    const first = work.firstPos[pi]!
    if (first === NO_POS) continue
    const pat = tt.patterns[pi]!
    const len = pat.stops.length
    let trip = -1
    let boardPos = -1
    for (let i = first; i < len; i++) {
      const p = pat.stops[i]!
      if (trip >= 0) {
        const t = pat.arr[trip * len + i]!
        if (t < work.bestArr[p]! && t < work.targetBest) {
          labels.arrT[base + p] = t
          labels.arrPat[base + p] = pi
          labels.arrTrip[base + p] = trip
          labels.arrBoardPos[base + p] = boardPos
          work.bestArr[p] = t
          work.arrMarked[p] = 1
          arrived = true
          if (t + labels.egressS[p]! < work.targetBest) {
            work.targetBest = t + labels.egressS[p]!
            labels.targetS[k] = work.targetBest
            labels.targetStop[k] = p
          }
        }
      }
      if (i < len - 1) {
        const ready = labels.readyT[prev + p]!
        if (ready < NO_TIME && (trip < 0 || ready <= pat.dep[trip * len + i]!)) {
          const earlier = earliestTrip(pat, i, ready, trip < 0 ? pat.tripIds.length : trip)
          if (earlier >= 0 && earlier !== trip) {
            trip = earlier
            boardPos = i
          }
        }
      }
    }
  }
  return arrived
}

/** Walk on from every stop reached this round: its change time, or a transfer to another station. */
function relaxFootpaths(tt: Timetable, labels: Labels, work: Work, k: number): boolean {
  const { footStart, footTo, footS } = tt.stops
  const n = labels.nStops
  const base = k * n
  let any = false
  for (let p = 0; p < n; p++) {
    if (!work.arrMarked[p]) continue
    work.arrMarked[p] = 0
    for (let e = footStart[p]!; e < footStart[p + 1]!; e++) {
      const q = footTo[e]!
      const t = labels.arrT[base + p]! + footS[e]!
      if (t < labels.readyT[base + q]! && t < work.targetBest) {
        labels.readyT[base + q] = t
        labels.readyFrom[base + q] = p
        labels.readyRound[base + q] = k
        work.readyMarked[q] = 1
        any = true
      }
    }
  }
  return any
}

/** Pareto-optimal journeys (arrival against transfers) between two sets of stations, fewest transfers first.
 *  Pass every station of a complex to seed or target all its members. Times are seconds since the day's
 *  midnight; a trip may run past 86400. Throws on an unknown station. */
export function route(
  tt: Timetable,
  from: readonly StationId[],
  to: readonly StationId[],
  departS: number,
  opts: RouteOptions = {},
): Journey[] {
  const maxTransfers = opts.maxTransfers ?? DEFAULT_MAX_TRANSFERS
  if (!Number.isInteger(maxTransfers) || maxTransfers < 0) throw new Error(`maxTransfers ${maxTransfers} is not a whole number >= 0`)
  if (!Number.isFinite(departS)) throw new Error(`departure time ${departS} is not a number`)
  const fromStops = stopsOfStations(tt.stops, from)
  const toStops = stopsOfStations(tt.stops, to)
  if (from.some((s) => to.includes(s))) return []

  const nStops = tt.stops.stopIds.length
  const rides = maxTransfers + 1
  const labels = allocLabels(rides, nStops, Math.ceil(departS))
  const work: Work = {
    bestArr: new Int32Array(nStops).fill(NO_TIME),
    readyMarked: new Uint8Array(nStops),
    arrMarked: new Uint8Array(nStops),
    firstPos: new Int32Array(tt.patterns.length),
    targetBest: NO_TIME,
  }
  fillEgress(tt, labels, toStops)
  seedRound(tt, labels, work, fromStops, toStops)
  for (let k = 1; k <= rides; k++) {
    const base = k * nStops
    for (const a of [labels.readyT, labels.readyFrom, labels.readyRound]) a.copyWithin(base, base - nStops, base)
    if (!scanRound(tt, labels, work, k) || k === rides) break
    if (!relaxFootpaths(tt, labels, work, k)) break
  }
  return journeys(tt, labels)
}
