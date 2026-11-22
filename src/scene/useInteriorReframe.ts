import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import type { IndexLoad } from '../data/interiorLoad'
import type { StreetLayer } from '../data/useStationStreets'
import type { Insets, Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { interiorReadyFor, reframeAction, reframeDuration, streetsReadyFor, type AwaitingInterior } from '../lib/interiorReframe'
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
  streets: StreetLayer | null
  index: IndexLoad
  network: Network
}

interface InteriorReframeOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  /** CameraRig sets it on a station flight whose interior isn't known, and clears it on a gesture or another flight. */
  awaiting: RefObject<AwaitingInterior | null>
  layout: RefObject<ReframeLayout>
  interior: InteriorModel | null
  streets: StreetLayer | null
  focusedId: string | null
  following: () => boolean
}

/**
 * Frames a station's interior that arrived too late for its flight: once the flight has landed and the interior is
 * known, a short eased flight (reframeDuration) moves onto the interior framing with the landing turn decided then;
 * reduced motion snaps there, no turn. A bare station's streets that arrived too late get the same, onto the framing
 * of its entrances (no turn). Asked when the interior, the streets or the focus changes, and on landing; returns the
 * landing call, which is stable (underground-by0). Runs per event (interior, focus, landing), never per frame.
 */
export function useInteriorReframe({
  controls,
  camera,
  flight,
  awaiting,
  layout,
  interior,
  streets,
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
      ready: a?.kind === 'streets' ? streetsReadyFor(a, l.streets) : interiorReadyFor(a, l.interior),
    })
    if (action === 'none' || action === 'wait') return
    awaiting.current = null
    const c = controls.current
    if (action === 'drop' || !c || !a) return
    flushMotion(c, camera)
    const az = c.getAzimuthalAngle()
    const turn = action === 'reframe'
    let dest: Destination
    if (a.kind === 'streets') {
      const station = l.network.stationById.get(a.stationId)
      if (!station) return
      dest = stationFlight(a.stationId, station.pos, bareStationPoints(a.stationId, l.streets, l.index), l.size, l.insets, l.panel, camera.fov, az)
    } else {
      if (!l.interior) return
      dest = interiorFlight(a.stationId, l.interior, l.size, l.insets, l.panel, camera.fov, az, turn)
    }
    if (!turn) {
      flight.current = newFlight(dest, c, camera, true)
      return
    }
    // A bare station's reframe may pull back as well as pan: the bigger of the two sets its pace.
    const move = Math.max(c.target.distanceTo(dest.target), Math.abs(dest.distance - camera.position.distanceTo(c.target)))
    const duration = reframeDuration(move, dest.azimuth === null ? 0 : wrapAngle(dest.azimuth - az))
    if (duration === null) return
    const f = newFlight(dest, c, camera, false)
    f.duration = duration
    flight.current = f
  }, [controls, camera, flight, awaiting, layout, following])

  // Passive, after CameraRig's layout effects: a fly request has armed `awaiting` and `layout` is current.
  useEffect(check, [interior, streets, focusedId, check])
  return check
}
