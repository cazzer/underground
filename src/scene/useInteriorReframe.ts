import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import type { IndexLoad } from '../data/interiorLoad'
import type { StreetLayer } from '../data/useStationStreets'
import type { PathFrame } from '../lib/pathFrame'
import type { Insets, Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import {
  classifyAwaiting,
  pathReadyFor,
  interiorReadyFor,
  nextAwaiting,
  reframeAction,
  reframeDuration,
  streetsMissingFor,
  streetsReadyFor,
  type AwaitingInterior,
} from '../lib/interiorReframe'
import type { Network } from '../lib/network'
import { wrapAngle } from '../lib/orbitLimits'
import { bareStationPoints, flushMotion, interiorFlight, newFlight, stationFlight, type Destination, type Flight, type MapControlsImpl } from './cameraFlight'
import type { InteriorModel } from './interiorModel'

/** What the reframe frames with, read when it starts (CameraRig's `latest`). */
export interface ReframeLayout {
  interior: InteriorModel | null
  panel: ScreenRect | null
  size: Viewport
  insets: Insets
  streets: StreetLayer | null | undefined
  index: IndexLoad
  network: Network
  /** The trip's way out at the loaded interior (pathFrame.ts), framed while the trip panel is open. */
  path: PathFrame | null
  tripOpen: boolean
}

interface InteriorReframeOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  /** CameraRig sets it on a station flight whose interior isn't known, and clears it on a gesture or another flight. */
  awaiting: RefObject<AwaitingInterior | null>
  layout: RefObject<ReframeLayout>
  interior: InteriorModel | null
  streets: StreetLayer | null | undefined
  index: IndexLoad
  panel: ScreenRect | null
  path: PathFrame | null
  focusedId: string | null
  following: () => boolean
}

/**
 * Frames a station's interior that arrived too late for its flight: once the flight has landed and the interior is
 * known, a short eased flight (reframeDuration) moves onto the interior framing with the landing turn decided then;
 * reduced motion snaps there, no turn. A bare station's streets that arrived too late get the same, onto the framing
 * of its entrances (no turn). While the trip panel is open a framed interior goes on awaiting the trip's way out
 * there: its arrival or a move of the panel reframes onto it (no turn), until a gesture, a focus change, a follow or
 * the panel closing. Asked when the interior, the streets, the index, the panel, the way out or the focus changes, and
 * on landing; returns the landing call, which is stable (underground-by0). Runs per event, never per frame.
 */
export function useInteriorReframe({
  controls,
  camera,
  flight,
  awaiting,
  layout,
  interior,
  streets,
  index,
  panel,
  path,
  focusedId,
  following,
}: InteriorReframeOptions): () => void {
  const focused = useRef(focusedId)
  useLayoutEffect(() => {
    focused.current = focusedId
  }, [focusedId])

  const check = useCallback(() => {
    const l = layout.current
    // A flight that set off before the index loaded (a deep link) learns here that its station is bare.
    const a = classifyAwaiting(awaiting.current, l.index)
    awaiting.current = a
    const ready =
      a?.kind === 'streets' ? streetsReadyFor(a, l.streets) : a?.kind === 'path' ? pathReadyFor(a, l.path, l.interior) : interiorReadyFor(a, l.interior)
    const action = reframeAction(a, {
      flying: flight.current !== null,
      following: following(),
      focusedId: focused.current,
      ready,
      missing: streetsMissingFor(a, l.streets) || (a?.kind === 'path' && !l.tripOpen),
    })
    if (action === 'none' || action === 'wait') return
    const c = controls.current
    if (action === 'drop' || !c || !a) {
      awaiting.current = null
      return
    }
    // An interior goes on awaiting the trip's way out while the trip panel is open; streets are done.
    awaiting.current = nextAwaiting(a, l.tripOpen)
    flushMotion(c, camera)
    const az = c.getAzimuthalAngle()
    const eased = action === 'reframe'
    let dest: Destination
    if (a.kind === 'streets') {
      dest = stationFlight(l.network, a.stationId, bareStationPoints(a.stationId, l.streets, l.index), l.size, l.insets, l.panel, camera.fov, az)
    } else {
      if (!l.interior) return
      // Only the interior's first framing decides a landing turn; the way out keeps the view's azimuth.
      dest = interiorFlight(a.stationId, l.interior, l.size, l.insets, l.panel, camera.fov, az, eased && a.kind === 'interior', l.path)
    }
    // A reframe may pull back as well as pan: the bigger of the two sets its pace.
    const move = Math.max(c.target.distanceTo(dest.target), Math.abs(dest.distance - camera.position.distanceTo(c.target)))
    const duration = reframeDuration(move, dest.azimuth === null ? 0 : wrapAngle(dest.azimuth - az))
    // Nothing to see move: the view already frames it, so its landing doesn't ask again.
    if (duration === null) return
    if (!eased) {
      flight.current = newFlight(dest, c, camera, true)
      return
    }
    const f = newFlight(dest, c, camera, false)
    f.duration = duration
    flight.current = f
  }, [controls, camera, flight, awaiting, layout, following])

  // Passive, after CameraRig's layout effects: a fly request has armed `awaiting` and `layout` is current.
  useEffect(check, [interior, streets, index, panel, path, focusedId, check])
  return check
}
