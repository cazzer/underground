import type { Labels, Timetable } from './types'

/** Scratch state of one query. */
export interface Work {
  /** Best arrival at a stop over every round so far. */
  bestArr: Int32Array
  readyMarked: Uint8Array
  arrMarked: Uint8Array
  firstPos: Int32Array
  targetBest: number
}

/** Walking to a target stop: 0 at the target itself, else the footpath into a target in another station. */
export function fillEgress(tt: Timetable, labels: Labels, toStops: Int32Array): void {
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
export function seedRound(tt: Timetable, labels: Labels, work: Work, fromStops: Int32Array, toStops: Int32Array): void {
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
