/** CameraRig's fly-to destinations and the per-frame helpers that move the camera along one. */
import type { MapControls } from '@react-three/drei'
import type { ComponentRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import type { IndexLoad } from '../data/interiorLoad'
import type { StreetLayer } from '../data/useStationStreets'
import { priorityLanding, type PriorityFrame } from '../lib/pathFrame'
import { bareStationFrame, type FramePoint } from '../lib/freeFrame'
import { flightDuration } from '../lib/flight'
import type { FlyRequest } from '../lib/focus'
import { EXIT_DISTANCE } from '../lib/focusMachine'
import { framePoint, type Insets, type Viewport } from '../lib/framing'
import { frameInterior, interiorFreeRect, landingAzimuth, type ScreenRect } from '../lib/interiorCamera'
import { stationIsBare } from '../lib/interiorReframe'
import type { Network } from '../lib/network'
import { wrapAngle } from '../lib/orbitLimits'
import type { Ground } from '../lib/projection'
import type { InteriorModel } from './interiorModel'

export type PointRequest = Extract<FlyRequest, { kind: 'point' }>
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
  /** A bare station's flight: the free rect's bottom (px) it framed in, so its landing can tell the panel moved since. */
  freeBottom?: number
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
 * With a priority frame at this interior (`frame`: the trip's path there, the machines out of service) it frames that
 * instead, as much of it as fits from the landing distance out, the target near one of the interior's stations, unless
 * the usual interior framing shows as much of it (priorityLanding).
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
  frame: PriorityFrame | null = null,
): Destination {
  const free = interiorFreeRect(viewport, insets, panel)
  const land = turn ? landingAzimuth(model.axis, azimuth, free) : azimuth
  const view = { azimuth: land, viewport, free, fovDeg }
  const plain = frameInterior({ ...model.focusAnchor, ...view })
  const { distance, target } = frame?.interiorId === model.stationId ? priorityLanding(frame, view, plain) : plain
  return {
    stationId,
    target: new Vector3(target.x, 0, target.z),
    distance,
    azimuth: land === azimuth ? null : land,
    follows: false,
  }
}

/**
 * Fly-to for a station with no interior: its point, its complex's other members' points and as many of its entrance
 * marks `points` as fit in the free area (above a stacked panel), from the landing distance out as far as they need,
 * the target near the station or a member (bareStationFrame in freeFrame.ts).
 */
export function stationFlight(
  network: Network,
  stationId: string,
  points: readonly Ground[],
  viewport: Viewport,
  insets: Insets,
  panel: ScreenRect | null,
  fovDeg: number,
  azimuth: number,
): Destination {
  const station = network.stationById.get(stationId)
  if (!station) throw new Error(`Station flight to unknown station "${stationId}"`)
  const free = interiorFreeRect(viewport, insets, panel)
  const members = complexMemberPoints(network, stationId)
  const { distance, target } = bareStationFrame({ station: station.pos, points, members, azimuth, viewport, free, fovDeg })
  return { stationId, target: new Vector3(target.x, 0, target.z), distance, azimuth: null, follows: false, freeBottom: free.bottom }
}

/** The points of the other members of `stationId`'s complex (network.groupById), in member order; none for a lone station. */
export function complexMemberPoints(network: Network, stationId: string): Ground[] {
  const ids = network.groupById.get(stationId)?.memberIds ?? []
  return ids.flatMap((id) => (id === stationId ? [] : [network.stationById.get(id)!.pos]))
}

/** A bare station's frame points by priority tier, as its landing wants them: its point, its complex's other members, its marks. */
export function bareStationTiers(network: Network, stationId: string, marks: readonly Ground[]): FramePoint[][] {
  const level = (p: Ground): FramePoint => ({ x: p.x, y: 0, z: p.z })
  const station = network.stationById.get(stationId)
  if (!station) throw new Error(`Station frame for unknown station "${stationId}"`)
  return [[level(station.pos)], complexMemberPoints(network, stationId).map(level), marks.map(level)]
}

/**
 * The entrance marks a bare station's flight frames, on the ground: its loaded streets' marks once the index says it
 * has no interior, else none (an interior station frames its interior; an unknown one waits for the index).
 */
export function bareStationPoints(stationId: string, streets: StreetLayer | null | undefined, index: IndexLoad): Ground[] {
  if (!stationIsBare(stationId, index) || !streets || streets.stationId !== stationId) return []
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
 * Points an in-flight `f` at `dest` from the camera's current pose (`az` its azimuth) at eased progress `e0`, keeping the
 * flight's timing, so the camera doesn't jump (a mid-flight retarget). `dest`'s `stationId` and `follows` are not copied.
 */
export function rebaseFlight(f: Flight, dest: Destination, c: MapControlsImpl, camera: PerspectiveCamera, az: number, e0: number): void {
  f.from.copy(c.target)
  f.fromDistance = camera.position.distanceTo(c.target)
  f.fromAzimuth = az
  f.e0 = e0
  f.target = dest.target
  f.distance = dest.distance
  f.azimuth = dest.azimuth
  f.freeBottom = dest.freeBottom
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
