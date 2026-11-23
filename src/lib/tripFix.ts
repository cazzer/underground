/**
 * A trip end filled from the location fix: which end it is and when it stops counting as one. The station a directions
 * pick took from the fix (`directionsTrip`'s `fixStation`) was never chosen by the visitor, so its station files are not
 * fetched for the trip until they pick it or focus it: the request would name the fix's nearest station. Pure.
 */
import type { TripEnds } from './tripView'

export type FixEnd = keyof TripEnds

/** The end that holds the fix's station, or null. Derived from the ends, so a swap moves it and a pick that replaces
 *  the station leaves none. */
export function fixEndOf(ends: TripEnds, fixStation: string | null): FixEnd | null {
  if (fixStation === null) return null
  if (ends.from === fixStation) return 'from'
  return ends.to === fixStation ? 'to' : null
}

/** After the visitor picks `stationId` for an end: picking the fix's station (for either end) is choosing it. */
export function afterPick(fixStation: string | null, stationId: string): string | null {
  return fixStation === stationId ? null : fixStation
}

/** After a focus change: focusing the fix's station is the visitor's own look at it (both are leads). */
export function afterFocus(fixStation: string | null, focusedId: string | null): string | null {
  return fixStation !== null && fixStation === focusedId ? null : fixStation
}
