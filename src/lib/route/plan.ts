/** The router in epoch seconds: a timetable plus the window that fixes its time base. Pure. */
import type { StationId, StopId } from '../../data/schema'
import { route } from './raptor'
import type { ServiceWindow } from './serviceDay'
import type { Journey, RideLeg, RouteOptions, Timetable, WalkLeg } from './types'

export interface RouterTimetable {
  timetable: Timetable
  window: ServiceWindow
}

/** Times are epoch seconds. */
export interface TripRideLeg extends Omit<RideLeg, 'departS' | 'arriveS'> {
  departAt: number
  arriveAt: number
  /** The pattern's last stop: the train's destination (the headsign), which may lie past `alightStop`. */
  terminalStop: StopId
}
export interface TripWalkLeg extends Omit<WalkLeg, 'startS' | 'endS'> {
  startAt: number
  endAt: number
}
export type TripLeg = TripRideLeg | TripWalkLeg

export interface TripJourney {
  departAt: number
  arriveAt: number
  transfers: number
  legs: TripLeg[]
}

const terminals = new WeakMap<Timetable, Map<string, StopId>>()

/** A pattern key to its last stop, built once per timetable (FIFO lanes `key#1` and `rt:` patterns are patterns too). */
function terminalsOf(tt: Timetable): Map<string, StopId> {
  let map = terminals.get(tt)
  if (!map) {
    map = new Map(tt.patterns.map((p) => [p.key, tt.stops.stopIds[p.stops[p.stops.length - 1]!]!]))
    terminals.set(tt, map)
  }
  return map
}

/** A router journey (seconds from the window's time base `startS`) in epoch seconds. */
export function toTripJourney(j: Journey, startS: number, terminalOf: ReadonlyMap<string, StopId>): TripJourney {
  const legs = j.legs.map((leg): TripLeg => {
    if (leg.kind === 'ride') {
      const { departS, arriveS, ...rest } = leg
      const terminalStop = terminalOf.get(rest.patternKey)
      if (terminalStop === undefined) throw new Error(`Journey rides unknown pattern "${rest.patternKey}"`)
      return { ...rest, departAt: departS + startS, arriveAt: arriveS + startS, terminalStop }
    }
    const { startS: legStart, endS, ...rest } = leg
    return { ...rest, startAt: legStart + startS, endAt: endS + startS }
  })
  return { departAt: j.departS + startS, arriveAt: j.arriveS + startS, transfers: j.transfers, legs }
}

/** Journeys from any of `from` to any of `to`, leaving no earlier than epoch second `atS`. */
export function planOn(
  rt: RouterTimetable,
  from: readonly StationId[],
  to: readonly StationId[],
  atS: number,
  opts?: RouteOptions,
): TripJourney[] {
  const terminalOf = terminalsOf(rt.timetable)
  return route(rt.timetable, from, to, atS - rt.window.startS, opts).map((j) => toTripJourney(j, rt.window.startS, terminalOf))
}
