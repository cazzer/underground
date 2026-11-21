/** CameraRig's fly-to destinations and the per-frame helpers that move the camera along one. */
import type { MapControls } from '@react-three/drei'
import type { ComponentRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import type { FlyRequest } from '../lib/focus'
import { EXIT_DISTANCE } from '../lib/focusMachine'
import { framePoint, type Insets, type Viewport } from '../lib/framing'
import { frameInterior, interiorFreeRect, LANDING_DISTANCE, landingAzimuth, type ScreenRect } from '../lib/interiorCamera'
import { wrapAngle } from '../lib/orbitLimits'
import type { Ground } from '../lib/projection'
import type { InteriorModel } from './interiorModel'

type PointRequest = Extract<FlyRequest, { kind: 'point' }>
export type MapControlsImpl = ComponentRef<typeof MapControls>

export interface Destination {
  /** Null for a flight to a point (a location fix): no station to hold focus on when interrupted. */
  stationId: string | null
  target: Vector3
  distance: number
  /** Azimuth to land at (radians), or null to keep the camera's own. */
  azimuth: number | null
}

/** A destination plus where the flight started; progress is eased by expoInOut (src/lib/flight.ts). */
export interface Flight extends Destination {
  from: Vector3
  fromDistance: number
  /** Camera azimuth when `from` was last set; the turn to `azimuth` runs from it with the rebased progress. */
  fromAzimuth: number
  elapsed: number
  duration: number
  /** Eased progress when `from` was last rebased (a mid-flight retarget); 0 at the start. */
  e0: number
}

const keepTarget = new Vector3()
const keepPosition = new Vector3()
/**
 * Drops the controls' leftover damped motion (pan offset and rotation delta) without moving the
 * camera. Otherwise momentum from a pan or wheel just before a fly-to resumes when the flight
 * lands and slides the view off the station (underground-3s3). A second undamped update() with
 * zero deltas re-syncs the controls' spherical state and the camera's aim to the restored pose, so
 * getAzimuthalAngle() afterwards is the camera's real angle. No allocation; the 'change' event it
 * dispatches copies its listener list, so call it on flight start and landing, not every frame.
 */
export function flushMotion(c: MapControlsImpl, camera: PerspectiveCamera): void {
  keepTarget.copy(c.target)
  keepPosition.copy(camera.position)
  const damping = c.enableDamping
  c.enableDamping = false
  c.update() // without damping, update() applies and zeroes the pending deltas
  c.target.copy(keepTarget)
  camera.position.copy(keepPosition)
  c.update() // deltas are zero now: re-syncs spherical, lastPosition and lookAt to the restored pose
  c.enableDamping = damping
}

/**
 * Fly-to that centers the interior in the screen area the HUD leaves free, at full reveal. A portrait free
 * area turns the view so the platforms run up the screen (landingAzimuth); otherwise it keeps `azimuth`.
 */
export function interiorFlight(
  model: InteriorModel,
  viewport: Viewport,
  insets: Insets,
  panel: ScreenRect | null,
  fovDeg: number,
  azimuth: number,
): Destination {
  const free = interiorFreeRect(viewport, insets, panel)
  const land = landingAzimuth(model.axis, azimuth, free)
  const { distance, target } = frameInterior({ ...model.focusAnchor, azimuth: land, viewport, free, fovDeg })
  return { stationId: model.stationId, target: new Vector3(target.x, 0, target.z), distance, azimuth: land }
}

/** Fly-to for a station with no interior: its point in the middle of the free area (above a stacked panel), at the landing distance. */
export function stationFlight(
  stationId: string,
  pos: Ground,
  viewport: Viewport,
  insets: Insets,
  panel: ScreenRect | null,
  fovDeg: number,
  azimuth: number,
): Destination {
  const free = interiorFreeRect(viewport, insets, panel)
  const { target } = frameInterior({ center: pos, towardCamera: 0, azimuth, viewport, free, fovDeg })
  return { stationId, target: new Vector3(target.x, 0, target.z), distance: LANDING_DISTANCE, azimuth: null }
}

/** Fly-to for a ground point (a location fix): `radiusM` in view, never closer than the focus range. */
export function pointFlight(req: PointRequest, viewport: Viewport, insets: Insets, fovDeg: number, maxDistance: number): Destination {
  const { distance, target } = framePoint(req.center, req.radiusM, viewport, insets, fovDeg, EXIT_DISTANCE * 1.2, maxDistance)
  return { stationId: null, target: new Vector3(target.x, 0, target.z), distance, azimuth: null }
}

/**
 * Turns the camera offset `offset` (camera minus target) about the vertical to the flight's azimuth at rebased
 * progress `e`, the short way round from `fromAzimuth`. A no-op for a flight that keeps the camera's azimuth.
 * The controls still clamp it to the orbit's window, so the turn opens up as the view tips. No allocation.
 */
export function turnOffset(offset: Vector3, f: Flight, e: number): void {
  if (f.azimuth === null) return
  const az = f.fromAzimuth + wrapAngle(f.azimuth - f.fromAzimuth) * e
  const h = Math.hypot(offset.x, offset.z)
  offset.x = h * Math.sin(az)
  offset.z = h * Math.cos(az)
}
