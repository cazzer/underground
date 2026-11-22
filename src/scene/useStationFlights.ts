import { useEffect, useLayoutEffect, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { interiorCovers, type IndexLoad } from '../data/interiorLoad'
import type { StreetLayer } from '../data/useStationStreets'
import type { FlyRequest } from '../lib/focus'
import type { FocusHold } from '../lib/focusHold'
import { flightProgress } from '../lib/flight'
import type { Insets, Viewport } from '../lib/framing'
import { LATE_TURN_PROGRESS, retargetTurn, type ScreenRect } from '../lib/interiorCamera'
import type { PathFrame } from '../lib/pathFrame'
import { classifyAwaiting, nextAwaiting, stationIsBare, streetsReadyFor, type AwaitingInterior } from '../lib/interiorReframe'
import type { Network } from '../lib/network'
import { prefersReducedMotion } from '../lib/reducedMotion'
import {
  bareStationPoints,
  flushMotion,
  interiorFlight,
  newFlight,
  pointFlight,
  stationFlight,
  type Flight,
  type MapControlsImpl,
} from './cameraFlight'
import type { InteriorModel } from './interiorModel'
import type { ReframeLayout } from './useInteriorReframe'

/** What a fly request frames with, read when it fires (CameraRig's `latest`). */
export interface FlightLayout extends ReframeLayout {
  maxDistance: number
}

interface StationFlightsOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  hold: RefObject<FocusHold | null>
  awaiting: RefObject<AwaitingInterior | null>
  layout: RefObject<FlightLayout>
  network: Network
  flyRequest: FlyRequest | null
  interior: InteriorModel | null
  panel: ScreenRect | null
  size: Viewport
  insets: Insets
  /** The focused station's streets once loaded (null: none; undefined: loading): a bare station's flight frames their entrances. */
  streets: StreetLayer | null | undefined
  /** The station index: a flight that set off before it loaded learns from it that its station is bare. */
  index: IndexLoad
  /** The trip's way out at the loaded interior (trip panel open): an interior flight frames it once it arrives. */
  path: PathFrame | null
}

/**
 * Starts the flight a fly request asks for (a station or a point), and retargets a station flight mid-way when its
 * interior, a bare station's streets or the panel's measurement arrives. Call it after CameraRig's `latest` layout effect, so a fly request
 * reads the current layout.
 */
export function useStationFlights({
  controls,
  camera,
  flight,
  hold,
  awaiting,
  layout,
  network,
  flyRequest,
  interior,
  panel,
  size,
  insets,
  streets,
  index,
  path,
}: StationFlightsOptions): void {
  // Layout effect, not a passive one: a frame between the select and a passive effect would see
  // the new focus with no flight and drop it again (the camera is still far out).
  useLayoutEffect(() => {
    if (!flyRequest) return
    if (flyRequest.kind === 'point') {
      const c = controls.current
      if (!c) throw new Error('Fly request before the map controls mounted')
      hold.current = null
      flushMotion(c, camera)
      awaiting.current = null
      const l = layout.current
      const dest = pointFlight(flyRequest, l.size, l.insets, camera.fov, l.maxDistance)
      flight.current = newFlight(dest, c, camera, prefersReducedMotion())
      return
    }
    const station = network.stationById.get(flyRequest.stationId)
    if (!station) throw new Error(`Fly request for unknown station "${flyRequest.stationId}"`)
    hold.current = null
    const l = layout.current
    const c = controls.current
    if (!c) throw new Error('Fly request before the map controls mounted')
    flushMotion(c, camera)
    const reduced = prefersReducedMotion()
    const known = interiorCovers(l.interior, station.id) ? l.interior : null
    // A bare station (the index lists no interior) awaits only its streets: nothing once they are cached, or once
    // its load found no file (null).
    const points = bareStationPoints(station.id, l.streets, l.index)
    // With the trip panel open, a framed interior goes on awaiting the trip's way out there (useInteriorReframe).
    if (known) awaiting.current = l.tripOpen ? { stationId: station.id, kind: 'path', reduced } : null
    else if (!stationIsBare(station.id, l.index)) awaiting.current = { stationId: station.id, kind: 'interior', reduced }
    else awaiting.current = l.streets === undefined ? { stationId: station.id, kind: 'streets', reduced } : null
    const dest = known
      ? interiorFlight(station.id, known, l.size, l.insets, l.panel, camera.fov, c.getAzimuthalAngle(), !reduced, l.path)
      : stationFlight(network, station.id, points, l.size, l.insets, l.panel, camera.fov, c.getAzimuthalAngle())
    flight.current = newFlight(dest, c, camera, reduced, known !== null || reduced)
  }, [flyRequest, network, camera, controls, flight, hold, awaiting, layout])

  // The interior (first visit), a bare station's streets or the index, the trip's way out, or the panel's measurement
  // (it grows as arrivals fill in) can land mid-flight: retarget that flight's destination. It rebases on the camera's current
  // pose and keeps the timing, so the camera doesn't jump. An interior or streets that arrive late in the flight, or
  // after it, are framed after landing (useInteriorReframe). Focus reached by zooming has no flight.
  useEffect(() => {
    const f = flight.current
    const c = controls.current
    if (!c || !f || f.stationId === null) return
    const station = network.stationById.get(f.stationId)
    if (!station) return
    const az = c.getAzimuthalAngle()
    const e0 = flightProgress(f.elapsed, f.duration)
    let dest
    if (!interior || !interiorCovers(interior, f.stationId)) {
      // A flight that set off before the index loaded (a deep link) learns here that its station is bare.
      const a = classifyAwaiting(awaiting.current, index)
      awaiting.current = a
      // Streets that load late in the flight wait for the landing too: the reframe folds them in. A station not known
      // to be bare has no points (bareStationPoints) and frames its point alone: the panel may still have changed.
      const late = a?.kind === 'streets' && e0 > LATE_TURN_PROGRESS
      const points = late ? [] : bareStationPoints(station.id, streets, index)
      dest = stationFlight(network, station.id, points, size, insets, panel, camera.fov, az)
      if (!late && streetsReadyFor(a, streets)) awaiting.current = null
    } else {
      const turn = retargetTurn(f.turnDecided, e0)
      // Later: too late to fold in without a lurch; the flight lands as it is and the reframe takes over.
      if (turn === 'later') return
      // Keep: frame for the azimuth already chosen (the landing turn, or the current one when there is none).
      dest = interiorFlight(f.stationId, interior, size, insets, panel, camera.fov, turn === 'keep' ? (f.azimuth ?? az) : az, turn === 'decide', path)
      if (turn === 'keep') dest.azimuth = f.azimuth
      f.turnDecided = true
      awaiting.current = nextAwaiting(awaiting.current, layout.current.tripOpen)
    }
    f.from.copy(c.target)
    f.fromDistance = camera.position.distanceTo(c.target)
    f.fromAzimuth = az
    f.e0 = e0
    f.target = dest.target
    f.distance = dest.distance
    f.azimuth = dest.azimuth
  }, [interior, panel, size, insets, streets, index, path, camera, network, controls, flight, awaiting, layout])
}
