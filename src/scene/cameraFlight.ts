/** CameraRig's fly-to destinations and the per-frame helpers that move the camera along one. */
import type { MapControls } from '@react-three/drei'
import type { ComponentRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { interiorIdOf, type IndexLoad } from '../data/interiorLoad'
import type { StreetLayer } from '../data/useStationStreets'
import { bareStationFrame } from '../lib/bareStationFrame'
import { flightDuration } from '../lib/flight'
import type { FlyRequest } from '../lib/focus'
import { EXIT_DISTANCE } from '../lib/focusMachine'
import { framePoint, type Insets, type Viewport } from '../lib/framing'
import { frameInterior, interiorFreeRect, landingAzimuth, type ScreenRect } from '../lib/interiorCamera'
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
  /** A flight to the selected train: the follow retargets it every frame to where the train has moved. */
  follows: boolean
}

/** A destination plus where the flight started; progress is eased by expoInOut (src/lib/flight.ts). */
export interface Flight extends Destination {
  from: Vector3
  fromDistance: number
  /** Camera azimuth when `from` was last set; the turn to `azimuth` runs from it with the rebased progress. */
  fromAzimuth: number
  /**
   * Whether the landing turn has been decided (once per flight, when the interior is first known, or never
   * for a point or a bare station). Retargets keep the decided `azimuth`, so a turn can't stop halfway or whip.
   */
  turnDecided: boolean
  elapsed: number
  duration: number
  /** Eased progress when `from` was last rebased (a mid-flight retarget); 0 at the start. */
  e0: number
}

/**
 * A flight from the camera's current pose to `dest`, snapping (duration 0) under reduced motion. `turnDecided` is
 * false only for a station flight whose interior isn't known yet (its landing turn is decided when it arrives).
 */
export function newFlight(dest: Destination, c: MapControlsImpl, camera: PerspectiveCamera, reduced: boolean, turnDecided = true): Flight {
  const fromDistance = camera.position.distanceTo(c.target)
  return {
    ...dest,
    from: c.target.clone(),
    fromDistance,
    fromAzimuth: c.getAzimuthalAngle(),
    turnDecided,
    elapsed: 0,
    duration: reduced ? 0 : flightDuration(fromDistance, dest.distance),
    e0: 0,
  }
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
 * Fly-to that centers the interior in the screen area the HUD leaves free, at full reveal, framed for
 * `azimuth`. With `turn`, a portrait free area first picks a landing azimuth that runs the platforms
 * nearly up the screen (landingAzimuth); the result's `azimuth` is that turn, or null for none. `stationId` is the
 * focused station, which for a complex member is not the model's own (file) id: the flight's focus hold follows it.
 */
export function interiorFlight(
  stationId: string,
  model: InteriorModel,
  viewport: Viewport,
  insets: Insets,
  panel: ScreenRect | null,
  fovDeg: number,
  azimuth: number,
  turn: boolean,
): Destination {
  const free = interiorFreeRect(viewport, insets, panel)
  const land = turn ? landingAzimuth(model.axis, azimuth, free) : azimuth
  const { distance, target } = frameInterior({ ...model.focusAnchor, azimuth: land, viewport, free, fovDeg })
  return {
    stationId,
    target: new Vector3(target.x, 0, target.z),
    distance,
    azimuth: land === azimuth ? null : land,
    follows: false,
  }
}

/**
 * Fly-to for a station with no interior: its point and its entrance marks `points` in the free area (above a stacked
 * panel), from the landing distance out as far as they need (bareStationFrame), the target near the station.
 */
export function stationFlight(
  stationId: string,
  pos: Ground,
  points: readonly Ground[],
  viewport: Viewport,
  insets: Insets,
  panel: ScreenRect | null,
  fovDeg: number,
  azimuth: number,
): Destination {
  const free = interiorFreeRect(viewport, insets, panel)
  const { distance, target } = bareStationFrame({ station: pos, points, azimuth, viewport, free, fovDeg })
  return { stationId, target: new Vector3(target.x, 0, target.z), distance, azimuth: null, follows: false }
}

/**
 * The entrance marks a bare station's flight frames, on the ground: its loaded streets' marks once the index says it
 * has no interior, else none (an interior station frames its interior; an unknown one waits for the index).
 */
export function bareStationPoints(stationId: string, streets: StreetLayer | null, index: IndexLoad): Ground[] {
  if (index.status !== 'ready' || interiorIdOf(stationId, index) !== null || streets?.stationId !== stationId) return []
  return streets.marks.map((m) => ({ x: streets.anchor.x + m.x, z: streets.anchor.z + m.z }))
}

/**
 * Fly-to for a ground point (a location fix): `radiusM` in view, landing outside the focus range at no less than
 * EXIT_DISTANCE, where the view is still top-down (the tilt's far end).
 */
export function pointFlight(req: PointRequest, viewport: Viewport, insets: Insets, fovDeg: number, maxDistance: number): Destination {
  const { distance, target } = framePoint(req.center, req.radiusM, viewport, insets, fovDeg, EXIT_DISTANCE, maxDistance)
  return { stationId: null, target: new Vector3(target.x, 0, target.z), distance, azimuth: null, follows: false }
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
