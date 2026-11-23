/**
 * The place hold's state for CameraRig (rules in lib/placeHold.ts): armed by a place fly request, ended by any other
 * request or by the user moving the view (useViewMoves, the location cap's detector). A layout effect applies the
 * request, so the hold is in force before any frame of the flight, as the location cap is. CameraRig reads
 * `holdsFocus(ref.current)` each frame and passes `settled = false` to the focus rules while it holds.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import type { CapEvent } from '../lib/basemap/locationCap'
import type { FlyRequest } from '../lib/focus'
import { holdOnFlight, holdOnPointer, newPlaceHold, type PlaceHold } from '../lib/placeHold'
import { useControlsElement, useViewMoves } from './useViewMoves'

export function usePlaceHold(flyRequest: FlyRequest | null): RefObject<PlaceHold> {
  const hold = useRef(newPlaceHold())
  const el = useControlsElement()
  useLayoutEffect(() => {
    if (flyRequest) holdOnFlight(hold.current, flyRequest)
  }, [flyRequest])
  const onViewMove = useCallback((e: CapEvent) => holdOnPointer(hold.current, e), [])
  useViewMoves(el, onViewMove)
  return hold
}
