import type { StationId, StopId, Transfer } from '../../data/schema'
import type { StopIndex } from './types'

/** Same-station change time when a station has no entry of its own. */
export const DEFAULT_CHANGE_S = 180

export interface StopIndexInput {
  stopIds: Iterable<StopId>
  /** Minimum change seconds per station, for the stations that differ from DEFAULT_CHANGE_S. */
  changeS: ReadonlyMap<StationId, number>
  transfers: readonly Transfer[]
}

export function stationOfStopId(id: StopId): StationId {
  const suffix = id.slice(-1)
  if (id.length < 2 || (suffix !== 'N' && suffix !== 'S')) {
    throw new Error(`stop id "${id}" is not a station id plus N or S`)
  }
  return id.slice(0, -1)
}

function checkSeconds(what: string, seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 0) throw new Error(`${what}: ${seconds} is not a whole number of seconds >= 0`)
}

/** Stops sorted and deduplicated; footpaths are every stop of a stop's own station (itself included) at the
 *  station's change time, plus every stop of each station a transfer row leads to. */
export function buildStopIndex(input: StopIndexInput): StopIndex {
  const stopIds = [...new Set(input.stopIds)].sort()
  const stopOf = new Map(stopIds.map((id, i) => [id, i]))
  const stationIds = [...new Set(stopIds.map(stationOfStopId))].sort()
  const stationOf = new Map(stationIds.map((id, i) => [id, i]))
  const stationOfStop = Int32Array.from(stopIds, (id) => stationOf.get(stationOfStopId(id))!)

  const stationStopStart = new Int32Array(stationIds.length + 1)
  for (const s of stationOfStop) stationStopStart[s + 1]! += 1
  for (let s = 0; s < stationIds.length; s++) stationStopStart[s + 1]! += stationStopStart[s]!
  const stationStops = new Int32Array(stopIds.length)
  const fill = stationStopStart.slice(0, -1)
  stationOfStop.forEach((s, p) => {
    stationStops[fill[s]!] = p
    fill[s]! += 1
  })
  const stopsOf = (s: number) => stationStops.subarray(stationStopStart[s]!, stationStopStart[s + 1]!)

  const requireStation = (what: string, id: StationId): number => {
    const s = stationOf.get(id)
    if (s === undefined) throw new Error(`${what}: station "${id}" has no stops`)
    return s
  }
  const changeOf = new Map<number, number>()
  for (const [id, seconds] of input.changeS) {
    checkSeconds(`change time of ${id}`, seconds)
    changeOf.set(requireStation('change time', id), seconds)
  }
  const linked = new Map<number, Map<number, number>>()
  for (const t of input.transfers) {
    const what = `transfer ${t.from} to ${t.to}`
    checkSeconds(what, t.minTransferSec)
    if (t.from === t.to) throw new Error(`${what}: a station cannot transfer to itself`)
    const from = requireStation(what, t.from)
    const to = requireStation(what, t.to)
    const row = linked.get(from) ?? new Map<number, number>()
    row.set(to, Math.min(row.get(to) ?? Infinity, t.minTransferSec))
    linked.set(from, row)
  }

  const footStart = new Int32Array(stopIds.length + 1)
  const footTo: number[] = []
  const footS: number[] = []
  for (let p = 0; p < stopIds.length; p++) {
    const s = stationOfStop[p]!
    const walk = new Map<number, number>()
    for (const q of stopsOf(s)) walk.set(q, changeOf.get(s) ?? DEFAULT_CHANGE_S)
    for (const [to, seconds] of linked.get(s) ?? []) for (const q of stopsOf(to)) walk.set(q, seconds)
    for (const q of [...walk.keys()].sort((a, b) => a - b)) {
      footTo.push(q)
      footS.push(walk.get(q)!)
    }
    footStart[p + 1] = footTo.length
  }

  return {
    stopIds,
    stopOf,
    stationIds,
    stationOf,
    stationOfStop,
    stationStopStart,
    stationStops,
    footStart,
    footTo: Int32Array.from(footTo),
    footS: Int32Array.from(footS),
  }
}

/** Every stop of the given stations, in the order given. Throws on an unknown station. */
export function stopsOfStations(index: StopIndex, stationIds: readonly StationId[]): Int32Array {
  const out: number[] = []
  for (const id of stationIds) {
    const s = index.stationOf.get(id)
    if (s === undefined) throw new Error(`unknown station "${id}"`)
    for (let e = index.stationStopStart[s]!; e < index.stationStopStart[s + 1]!; e++) out.push(index.stationStops[e]!)
  }
  return Int32Array.from(out)
}
