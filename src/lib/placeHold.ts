/**
 * The place hold: a searched place lands at street zoom, inside the focus range, and auto-focus must not open a
 * station panel the user didn't ask for there. From a place fly request until the user moves the view, auto-focus may
 * not enter a station (exits still apply: CameraRig passes `settled = false` to nextFocus while held).
 *
 * "Moves the view" is the location cap's own detector (locationCap.ts: a drag past the 6 px mouse / 10 px touch
 * slop, a second finger, a wheel step), so the two never disagree; a tap that doesn't move keeps the hold. Any other
 * flight (a station pick, "Go to", a location fix, a followed train) ends it, and a new place re-arms it. The state is
 * the cap's, `capped` meaning "held". Allocation-free per pointer move.
 */
import { capStep, newCap, type CapEvent, type CapState } from './basemap/locationCap'

export type PlaceHold = CapState

export function newPlaceHold(): PlaceHold {
  return newCap()
}

/** What a fly request is to the hold: a place arms it, any other flight ends it. */
export type HoldFlight = { kind: 'station' } | { kind: 'point'; source: 'locate' | 'place' }

export function holdOnFlight(hold: PlaceHold, req: HoldFlight): void {
  capStep(hold, req.kind === 'point' && req.source === 'place' ? { type: 'pointFlight' } : { type: 'station' })
}

/** A pointer event from useViewMoves: a move past the slop, a pinch or a wheel step ends the hold. */
export function holdOnPointer(hold: PlaceHold, e: CapEvent): void {
  capStep(hold, e)
}

/** Ends the hold (a followed train takes the camera over). */
export function releaseHold(hold: PlaceHold): void {
  capStep(hold, { type: 'station' })
}

/** True while auto-focus may not enter a station. */
export function holdsFocus(hold: PlaceHold): boolean {
  return hold.capped
}
