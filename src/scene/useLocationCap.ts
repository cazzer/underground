/**
 * Drives the shared location cap (lib/basemap/locationCapHandle.ts) from the scene: a location point flight caps
 * tile zoom at CAP_Z until the user moves the view past the click slop, wheels, pinches or picks a station or a
 * searched place (locationCap.ts). Mounted once by Scene (LocationCapSource.tsx), whether or not the basemap is, so
 * every view-driven fetch can read the one cap: `cap.isCapped()` for now, `cap.subscribe` for changes (the basemap's
 * `store.capZoom`, useBasemapTiles.ts).
 *
 * Ordering: CameraRig starts a flight in a layout effect and moves the camera only in later frames; the cap is
 * set in a layout effect of the same commit, so it is in force before any frame of the flight, even a reduced-motion
 * one that lands in its first frame. The pointer listeners are passive, on the element MapControls listens on
 * (r3f's connected element, as drei picks it) and the window, never MapControls props (a changed on* prop makes drei
 * reconnect the controls, AGENTS.md). Not lifted by: following a train, keyboard input.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { CapEvent } from '../lib/basemap/locationCap'
import type { LocationCap } from '../lib/basemap/locationCapHandle'
import { useFocus, type FlyRequest } from '../lib/focus'
import { useControlsElement, useViewMoves } from './useViewMoves'

export function useLocationCap(cap: LocationCap): void {
  const el = useControlsElement()
  const { flyRequest } = useFocus()
  const handled = useRef<FlyRequest | null>(null)

  useLayoutEffect(() => {
    if (flyRequest === handled.current) return
    handled.current = flyRequest
    // A searched place is the user's pick, like a station: only a location flight sets the cap.
    if (flyRequest?.kind === 'point' && flyRequest.source === 'locate') cap.step({ type: 'pointFlight' })
    else if (flyRequest) cap.step({ type: 'station' })
  }, [flyRequest, cap])

  const onViewMove = useCallback((e: CapEvent) => cap.step(e), [cap])
  useViewMoves(el, onViewMove)

  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, locationCapped: () => cap.isCapped() }
    return () => {
      if (window.__underground) delete window.__underground.locationCapped
    }
  }, [cap])
}
