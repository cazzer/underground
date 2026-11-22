/** The router in epoch seconds: a timetable plus the window that fixes its time base. Pure. */
import type { StationId } from '../../data/schema'
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

/** A router journey (seconds from the window's time base `startS`) in epoch seconds. */
export function toTripJourney(j: Journey, startS: number): TripJourney {
  const legs = j.legs.map((leg): TripLeg => {
    if (leg.kind === 'ride') {
      const { departS, arriveS, ...rest } = leg
      return { ...rest, departAt: departS + startS, arriveAt: arriveS + startS }
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
  return route(rt.timetable, from, to, atS - rt.window.startS, opts).map((j) => toTripJourney(j, rt.window.startS))
}
