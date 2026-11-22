/** Shared types of the pure RAPTOR router. Nothing here reads a file format: the loader (2q7.6) builds these. */
import type { RouteId, StationId, StopId } from '../../data/schema'

/** "Unreached" time. Small enough that `t + walk` never overflows an Int32. */
export const NO_TIME = 0x3fffffff

/** Stops, stations and footpaths as typed arrays. Never mutated after build. */
export interface StopIndex {
  stopIds: readonly StopId[]
  stopOf: ReadonlyMap<StopId, number>
  stationIds: readonly StationId[]
  stationOf: ReadonlyMap<StationId, number>
  stationOfStop: Int32Array
  /** CSR over stations (length nStations + 1) into `stationStops`. */
  stationStopStart: Int32Array
  stationStops: Int32Array
  /** Footpaths, CSR over stops (length nStops + 1): walking from a stop to `footTo` takes `footS` seconds.
   *  A stop's own entry is the minimum change time at its station. */
  footStart: Int32Array
  footTo: Int32Array
  footS: Int32Array
}

/** Trips of one stop sequence, FIFO (no trip overtakes another). Never mutated after build. */
export interface Pattern {
  /** Unique per Timetable; FIFO splits get "#1", "#2". */
  key: string
  /** Stop indices, length n >= 2. */
  stops: Int32Array
  /** Opaque per trip (the loader fills these with trip keys). */
  tripIds: readonly string[]
  /** Per trip: patterns are keyed by stop sequence, so two routes can share one. */
  routeIds: readonly RouteId[]
  /** Seconds since the service day's start (`serviceDayStart`: noon minus 12 h, an hour off midnight on DST days; negative or past 86400 is fine), row per trip: [trip * n + i]. */
  arr: Int32Array
  dep: Int32Array
}

/** Never mutated after build. */
export interface Timetable {
  stops: StopIndex
  patterns: readonly Pattern[]
  /** Stop to (pattern, position) CSR: `patAt` and `patPos` over `patStart` (length nStops + 1). */
  patStart: Int32Array
  patAt: Int32Array
  patPos: Int32Array
}

export interface RideLeg {
  kind: 'ride'
  routeId: RouteId
  tripId: string
  patternKey: string
  boardStop: StopId
  alightStop: StopId
  /** Board to alight, inclusive. */
  stops: readonly StopId[]
  departS: number
  arriveS: number
}

/** A change inside a station (`sameStation`, possibly 0 s), a transfer between stations, or a walk to the target. */
export interface WalkLeg {
  kind: 'walk'
  fromStop: StopId
  toStop: StopId
  sameStation: boolean
  startS: number
  durationS: number
  endS: number
}

export type Leg = RideLeg | WalkLeg

export interface Journey {
  /** Start of the first leg: a train's departure for a ride-first journey, the query time for a walk-first one
   *  (any wait for the next train follows that walk). */
  departS: number
  arriveS: number
  transfers: number
  legs: Leg[]
}

export interface RouteOptions {
  /** Default 4. */
  maxTransfers?: number
}

/** The per-round labels one query fills, flat `[k * nStops + p]` (the `egress*` ones are per stop). */
export interface Labels {
  rounds: number
  nStops: number
  departS: number
  /** Time you step off a train at a stop in round k, with the pattern, trip and boarding position that did it. */
  arrT: Int32Array
  arrPat: Int32Array
  arrTrip: Int32Array
  arrBoardPos: Int32Array
  /** Earliest time you can board at a stop in round k (after a change or walk), the stop you walked from (-1 at
   *  the origin) and the round that stop's arrival label is in. */
  readyT: Int32Array
  readyFrom: Int32Array
  readyRound: Int32Array
  /** Per round: best target arrival if this round improved on every earlier one, else NO_TIME, and its stop. */
  targetS: Int32Array
  targetStop: Int32Array
  /** Per stop: walk to a target stop and which one (-1 when the stop is itself a target). */
  egressS: Int32Array
  egressTo: Int32Array
}
