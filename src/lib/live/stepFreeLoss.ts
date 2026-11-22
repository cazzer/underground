import type { StationInterior } from '../../data/stationSchema'
import { routesToStreet } from '../interiorGraph'

/**
 * Whether outages leave an accessible station with a platform that has no step-free way to the street: some track
 * has one without `closed` and none with it. Never true for a station that isn't accessible, with no machine
 * closed, or when status is unknown (`closed` null: the panel then says nothing rather than guess). A track with
 * no step-free route even when everything works (a partly accessible station's other direction) doesn't count.
 */
export function noStepFreeNow(interior: StationInterior, accessible: boolean, closed: ReadonlySet<string> | null): boolean {
  if (!accessible || closed === null || closed.size === 0) return false
  const stops = new Set(interior.platforms.flatMap((p) => p.tracks.map((t) => t.stopId)))
  for (const stop of stops) {
    const working = routesToStreet(interior, stop, { stepFree: true })
    if (working === null || working.length === 0) continue
    if (routesToStreet(interior, stop, { stepFree: true, closed })?.length === 0) return true
  }
  return false
}
