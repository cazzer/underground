import type { RouteId, StopId } from '../../data/schema'
import type { Pattern, StopIndex, Timetable } from './types'

export interface TripInput {
  id: string
  routeId: RouteId
  /** Seconds since the service day's start (`serviceDayStart`: noon minus 12 h, an hour off midnight on DST days), one per stop. */
  arr: ArrayLike<number>
  dep: ArrayLike<number>
}

export interface PatternInput {
  key: string
  stops: readonly StopId[]
  trips: readonly TripInput[]
}

function checkTrip(key: string, trip: TripInput, n: number): void {
  const where = `pattern ${key}, trip ${trip.id}`
  if (trip.arr.length !== n || trip.dep.length !== n) throw new Error(`${where}: arr and dep need ${n} times`)
  for (let i = 0; i < n; i++) {
    const a = trip.arr[i]!
    const d = trip.dep[i]!
    if (!Number.isInteger(a) || !Number.isInteger(d)) throw new Error(`${where}: stop ${i} has a non-integer time`)
    if (a > d) throw new Error(`${where}: stop ${i} departs before it arrives`)
    if (i < n - 1 && d > trip.arr[i + 1]!) throw new Error(`${where}: times go backward after stop ${i}`)
  }
}

/** `b` never overtakes `a` (a ran first): at every stop b arrives and departs no earlier. */
function follows(a: TripInput, b: TripInput): boolean {
  for (let i = 0; i < a.arr.length; i++) if (b.arr[i]! < a.arr[i]! || b.dep[i]! < a.dep[i]!) return false
  return true
}

function toPattern(key: string, stops: Int32Array, trips: readonly TripInput[]): Pattern {
  const n = stops.length
  const arr = new Int32Array(trips.length * n)
  const dep = new Int32Array(trips.length * n)
  trips.forEach((trip, row) => {
    for (let i = 0; i < n; i++) {
      arr[row * n + i] = trip.arr[i]!
      dep[row * n + i] = trip.dep[i]!
    }
  })
  return { key, stops, tripIds: trips.map((t) => t.id), routeIds: trips.map((t) => t.routeId), arr, dep }
}

/** One input pattern as FIFO patterns: trips sorted by first departure, then split greedily into chains where no
 *  trip overtakes the one before it. The first chain keeps the key, the rest get "#1", "#2". */
export function makePatterns(index: StopIndex, input: PatternInput): Pattern[] {
  const n = input.stops.length
  if (n < 2) throw new Error(`pattern ${input.key}: needs at least 2 stops`)
  const stops = Int32Array.from(input.stops, (id) => {
    const p = index.stopOf.get(id)
    if (p === undefined) throw new Error(`pattern ${input.key}: unknown stop "${id}"`)
    return p
  })
  for (const trip of input.trips) checkTrip(input.key, trip, n)
  const sorted = [...input.trips].sort(
    (a, b) => a.dep[0]! - b.dep[0]! || a.arr[n - 1]! - b.arr[n - 1]! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const chains: TripInput[][] = []
  for (const trip of sorted) {
    const chain = chains.find((c) => follows(c[c.length - 1]!, trip))
    if (chain) chain.push(trip)
    else chains.push([trip])
  }
  return chains.map((chain, j) => toPattern(j === 0 ? input.key : `${input.key}#${j}`, stops, chain))
}

/** Adds the stop to (pattern, position) lookup. Patterns are used as given, never merged. */
export function buildTimetable(index: StopIndex, patterns: readonly Pattern[]): Timetable {
  const keys = new Set<string>()
  const nStops = index.stopIds.length
  const patStart = new Int32Array(nStops + 1)
  for (const pat of patterns) {
    if (keys.has(pat.key)) throw new Error(`duplicate pattern key "${pat.key}"`)
    keys.add(pat.key)
    for (const p of pat.stops) patStart[p + 1]! += 1
  }
  for (let p = 0; p < nStops; p++) patStart[p + 1]! += patStart[p]!
  const patAt = new Int32Array(patStart[nStops]!)
  const patPos = new Int32Array(patAt.length)
  const fill = patStart.slice(0, -1)
  patterns.forEach((pat, pi) => {
    pat.stops.forEach((p, pos) => {
      patAt[fill[p]!] = pi
      patPos[fill[p]!] = pos
      fill[p]! += 1
    })
  })
  return { stops: index, patterns, patStart, patAt, patPos }
}
