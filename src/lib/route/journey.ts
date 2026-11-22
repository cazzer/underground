import { NO_TIME, type Journey, type Labels, type Leg, type RideLeg, type Timetable, type WalkLeg } from './types'

function walkLeg(tt: Timetable, from: number, to: number, startS: number, durationS: number): WalkLeg {
  const { stopIds, stationOfStop } = tt.stops
  return {
    kind: 'walk',
    fromStop: stopIds[from]!,
    toStop: stopIds[to]!,
    sameStation: stationOfStop[from] === stationOfStop[to],
    startS,
    durationS,
    endS: startS + durationS,
  }
}

/** The ride that left you at stop `p` in round `r`, board to alight. */
function rideLeg(tt: Timetable, labels: Labels, r: number, p: number): RideLeg {
  const idx = r * labels.nStops + p
  const pat = tt.patterns[labels.arrPat[idx]!]!
  const trip = labels.arrTrip[idx]!
  const boardPos = labels.arrBoardPos[idx]!
  const arriveS = labels.arrT[idx]!
  const n = pat.stops.length
  let alightPos = -1
  for (let i = boardPos + 1; i < n && alightPos < 0; i++) {
    if (pat.stops[i] === p && pat.arr[trip * n + i] === arriveS) alightPos = i
  }
  if (alightPos < 0) throw new Error(`no alight position for stop ${tt.stops.stopIds[p]} in pattern ${pat.key}`)
  const { stopIds } = tt.stops
  return {
    kind: 'ride',
    routeId: pat.routeIds[trip]!,
    tripId: pat.tripIds[trip]!,
    patternKey: pat.key,
    boardStop: stopIds[pat.stops[boardPos]!]!,
    alightStop: stopIds[p]!,
    stops: Array.from(pat.stops.subarray(boardPos, alightPos + 1), (s) => stopIds[s]!),
    departS: pat.dep[trip * n + boardPos]!,
    arriveS,
  }
}

/** Round 0: a walk from an origin stop to the target stop. */
function walkOnly(tt: Timetable, labels: Labels): Leg[] {
  const q = labels.targetStop[0]!
  return [walkLeg(tt, labels.readyFrom[q]!, q, labels.departS, labels.readyT[q]! - labels.departS)]
}

/** Round k: follow the labels back from the target stop. Walks are anchored at their start (the arrival or the
 *  query time); the wait for the next ride is the gap after them. */
function rides(tt: Timetable, labels: Labels, k: number): Leg[] {
  const n = labels.nStops
  const legs: Leg[] = []
  let p = labels.targetStop[k]!
  let r = k
  if (labels.egressTo[p]! >= 0) legs.push(walkLeg(tt, p, labels.egressTo[p]!, labels.arrT[r * n + p]!, labels.egressS[p]!))
  for (;;) {
    const ride = rideLeg(tt, labels, r, p)
    legs.push(ride)
    const board = tt.stops.stopOf.get(ride.boardStop)!
    const at = (r - 1) * n + board
    const from = labels.readyFrom[at]!
    if (from === -1) break
    const fromRound = labels.readyRound[at]!
    const startS = fromRound === 0 ? labels.departS : labels.arrT[fromRound * n + from]!
    legs.push(walkLeg(tt, from, board, startS, labels.readyT[at]! - startS))
    if (fromRound === 0) break
    p = from
    r = fromRound
  }
  return legs.reverse()
}

const legStart = (leg: Leg): number => (leg.kind === 'ride' ? leg.departS : leg.startS)
const legEnd = (leg: Leg): number => (leg.kind === 'ride' ? leg.arriveS : leg.endS)

/** One journey per round that beat every earlier round: ascending transfers, descending arrival. */
export function journeys(tt: Timetable, labels: Labels): Journey[] {
  const out: Journey[] = []
  for (let k = 0; k <= labels.rounds; k++) {
    if (labels.targetS[k]! >= NO_TIME) continue
    const legs = k === 0 ? walkOnly(tt, labels) : rides(tt, labels, k)
    const rideCount = legs.filter((l) => l.kind === 'ride').length
    out.push({
      departS: legStart(legs[0]!),
      arriveS: legEnd(legs[legs.length - 1]!),
      transfers: Math.max(0, rideCount - 1),
      legs,
    })
  }
  return out
}
