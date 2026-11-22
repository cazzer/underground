import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { interiorCovers } from '../data/interiorLoad'
import type { Insets, Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { reframeAction, reframeDuration, type AwaitingInterior } from '../lib/interiorReframe'
import { wrapAngle } from '../lib/orbitLimits'
import { flushMotion, interiorFlight, newFlight, type Flight, type MapControlsImpl } from './cameraFlight'
import type { InteriorModel } from './interiorModel'

/** What the reframe frames with, read when it starts (CameraRig's `latest`). */
export interface ReframeLayout {
  interior: InteriorModel | null
  panel: ScreenRect | null
  size: Viewport
  insets: Insets
}

interface InteriorReframeOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  /** CameraRig sets it on a station flight whose interior isn't known, and clears it on a gesture or another flight. */
  awaiting: RefObject<AwaitingInterior | null>
  layout: RefObject<ReframeLayout>
  interior: InteriorModel | null
  focusedId: string | null
  following: () => boolean
}

/**
 * Frames a station's interior that arrived too late for its flight: once the flight has landed and the interior is
 * known, a short eased flight (reframeDuration) moves onto the interior framing with the landing turn decided then;
 * reduced motion snaps there, no turn. Asked when the interior or the focus changes, and on landing; returns the
 * landing call, which is stable (underground-by0). Runs per event (interior, focus, landing), never per frame.
 */
export function useInteriorReframe({
  controls,
  camera,
  flight,
  awaiting,
  layout,
  interior,
  focusedId,
  following,
}: InteriorReframeOptions): () => void {
  const focused = useRef(focusedId)
  useLayoutEffect(() => {
    focused.current = focusedId
  }, [focusedId])

  const check = useCallback(() => {
    const l = layout.current
    const a = awaiting.current
    const action = reframeAction(a, {
      flying: flight.current !== null,
      following: following(),
      focusedId: focused.current,
      interiorReady: a !== null && interiorCovers(l.interior, a.stationId),
    })
    if (action === 'none' || action === 'wait') return
    awaiting.current = null
    const c = controls.current
    if (action === 'drop' || !c || !l.interior || !a) return
    flushMotion(c, camera)
    const az = c.getAzimuthalAngle()
    const turn = action === 'reframe'
    const dest = interiorFlight(a.stationId, l.interior, l.size, l.insets, l.panel, camera.fov, az, turn)
    if (!turn) {
      flight.current = newFlight(dest, c, camera, true)
      return
    }
    const duration = reframeDuration(c.target.distanceTo(dest.target), dest.azimuth === null ? 0 : wrapAngle(dest.azimuth - az))
    if (duration === null) return
    const f = newFlight(dest, c, camera, false)
    f.duration = duration
    flight.current = f
  }, [controls, camera, flight, awaiting, layout, following])

  // Passive, after CameraRig's layout effects: a fly request has armed `awaiting` and `layout` is current.
  useEffect(check, [interior, focusedId, check])
  return check
}
