import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { useFocus, type FlyRequest } from '../lib/focus'
import { shouldReleaseHold, type FocusHold } from '../lib/focusHold'
import { EXIT_DISTANCE, nextFocus, type FocusInput } from '../lib/focusMachine'
import { flightDistance, flightDuration, flightProgress, rebasedProgress, remainingPan } from '../lib/flight'
import { frameBounds, framePoint, type Insets, type Viewport } from '../lib/framing'
import { frameInterior, interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { tiltForDistance } from '../lib/tilt'
import type { InteriorModel } from './interiorModel'
import { useStationOrbit } from './useStationOrbit'

type PointRequest = Extract<FlyRequest, { kind: 'point' }>

type MapControlsImpl = ComponentRef<typeof MapControls>

const keepTarget = new Vector3()
const keepPosition = new Vector3()
/**
 * Drops the controls' leftover damped motion (pan offset, rotation and zoom deltas) without moving
 * the camera. Otherwise momentum from a pan or wheel just before a fly-to resumes when the flight
 * lands and slides the view off the station (underground-3s3). Allocation-free; safe per frame.
 */
function flushMotion(c: MapControlsImpl, camera: PerspectiveCamera): void {
  keepTarget.copy(c.target)
  keepPosition.copy(camera.position)
  const damping = c.enableDamping
  c.enableDamping = false
  c.update() // without damping, update() applies and zeroes the pending deltas
  c.enableDamping = damping
  c.target.copy(keepTarget)
  camera.position.copy(keepPosition)
}

const MIN_DISTANCE = 40
/** How far past the fitted city overview the user may zoom out. */
const MAX_ZOOM_OUT = 1.3
/** Camera distance after clicking a station: inside the fully-tilted range. */
const FOCUS_DISTANCE = 170

interface Destination {
  /** Null for a flight to a point (a location fix): no station to hold focus on when interrupted. */
  stationId: string | null
  target: Vector3
  distance: number
}

/** A destination plus where the flight started; progress is eased by expoInOut (src/lib/flight.ts). */
interface Flight extends Destination {
  from: Vector3
  fromDistance: number
  elapsed: number
  duration: number
  /** Eased progress when `from` was last rebased (a mid-flight retarget); 0 at the start. */
  e0: number
}

/** Fly-to that centers the interior in the screen area the HUD leaves free, at full reveal, from the current azimuth. */
function interiorFlight(
  model: InteriorModel,
  viewport: Viewport,
  insets: Insets,
  panel: ScreenRect | null,
  fovDeg: number,
  azimuth: number,
): Destination {
  const free = interiorFreeRect(viewport, insets, panel)
  const { distance, target } = frameInterior({ ...model.focusAnchor, azimuth, viewport, free, fovDeg })
  return { stationId: model.stationId, target: new Vector3(target.x, 0, target.z), distance }
}

/** Fly-to for a ground point (a location fix): `radiusM` in view, never closer than the focus range. */
function pointFlight(req: PointRequest, viewport: Viewport, insets: Insets, fovDeg: number, maxDistance: number): Destination {
  const { distance, target } = framePoint(req.center, req.radiusM, viewport, insets, fovDeg, EXIT_DISTANCE * 1.2, maxDistance)
  return { stationId: null, target: new Vector3(target.x, 0, target.z), distance }
}

interface CameraRigProps {
  network: Network
  /** HUD-covered bands; the opening view fits the city between them. */
  insets: Insets
  /** The focused station's interior once loaded; a click on that station frames it instead. */
  interior: InteriorModel | null
  /** The station panel's screen rect, kept clear when framing an interior. */
  panel: ScreenRect | null
}

export function CameraRig({ network, insets, interior, panel }: CameraRigProps) {
  const controls = useRef<MapControlsImpl>(null)
  const flight = useRef<Flight | null>(null)
  const hold = useRef<FocusHold | null>(null)
  const scratch = useRef(new Vector3())
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const get = useThree((s) => s.get)
  const size = useThree((s) => s.size)
  const maxDistance = frameBounds(network.bounds, size, insets, camera.fov).distance * MAX_ZOOM_OUT
  const { focusedId, dismissedId, flyRequest, updateFromCamera } = useFocus()
  // Reused every frame so the per-frame focus check doesn't allocate.
  const input = useRef<FocusInput>({
    focusedId,
    dismissedId,
    distance: 0,
    target: { x: 0, z: 0 },
    stations: network.stations,
  })

  // Fit the whole city once; resizing later keeps the user's view.
  useLayoutEffect(() => {
    const { distance, target } = frameBounds(network.bounds, get().size, insets, camera.fov)
    camera.position.set(target.x, distance, target.z + 0.001)
    controls.current?.target.set(target.x, 0, target.z)
    controls.current?.update()
    // Only the opening view; later inset or size changes keep the user's view.
  }, [camera, get, network])

  useLayoutEffect(() => {
    camera.far = maxDistance * 2
    camera.updateProjectionMatrix()
  }, [camera, maxDistance])

  // Read by the fly effect through a ref: depending on these would re-fire a stale fly request.
  const latest = useRef({ interior, panel, size, insets, maxDistance })
  useLayoutEffect(() => {
    latest.current = { interior, panel, size, insets, maxDistance }
  }, [interior, panel, size, insets, maxDistance])

  // Layout effect, not a passive one: a frame between the select and a passive effect would see
  // the new focus with no flight and drop it again (the camera is still far out).
  useLayoutEffect(() => {
    if (!flyRequest) return
    if (flyRequest.kind === 'point') {
      const c = controls.current
      if (!c) throw new Error('Fly request before the map controls mounted')
      hold.current = null
      flushMotion(c, camera)
      const l = latest.current
      const dest = pointFlight(flyRequest, l.size, l.insets, camera.fov, l.maxDistance)
      const fromDistance = camera.position.distanceTo(c.target)
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      flight.current = {
        ...dest,
        from: c.target.clone(),
        fromDistance,
        elapsed: 0,
        duration: reduced ? 0 : flightDuration(fromDistance, dest.distance),
        e0: 0,
      }
      return
    }
    const station = network.stationById.get(flyRequest.stationId)
    if (!station) throw new Error(`Fly request for unknown station "${flyRequest.stationId}"`)
    hold.current = null
    const l = latest.current
    const c = controls.current
    if (!c) throw new Error('Fly request before the map controls mounted')
    flushMotion(c, camera)
    const dest =
      l.interior?.stationId === station.id
        ? interiorFlight(l.interior, l.size, l.insets, l.panel, camera.fov, c.getAzimuthalAngle())
        : { stationId: station.id, target: new Vector3(station.pos.x, 0, station.pos.z), distance: FOCUS_DISTANCE }
    const fromDistance = camera.position.distanceTo(c.target)
    flight.current = {
      ...dest,
      from: c.target.clone(),
      fromDistance,
      elapsed: 0,
      duration: flightDuration(fromDistance, dest.distance),
      e0: 0,
    }
  }, [flyRequest, network, camera])

  // The interior (first visit) or the panel's measurement can land mid-flight: retarget that
  // flight's destination. It rebases on the camera's current pose and keeps the timing, so the
  // camera doesn't jump. Focus reached by zooming has no flight, and the camera never moves on its own.
  useEffect(() => {
    const f = flight.current
    const c = controls.current
    if (interior && c && f?.stationId === interior.stationId) {
      const dest = interiorFlight(interior, size, insets, panel, camera.fov, c.getAzimuthalAngle())
      f.from.copy(c.target)
      f.fromDistance = camera.position.distanceTo(c.target)
      f.e0 = flightProgress(f.elapsed, f.duration)
      f.target = dest.target
      f.distance = dest.distance
    }
  }, [interior, panel, size, insets, camera])

  const focusPos = (focusedId && network.stationById.get(focusedId)?.pos) || null
  const flying = useCallback(() => flight.current !== null, [])
  const busy = useCallback(() => flight.current !== null || hold.current !== null, [])
  const free = useMemo(() => interiorFreeRect(size, insets, panel), [size, insets, panel])
  useStationOrbit({
    controls,
    camera,
    focusPos,
    interior: interior?.stationId === focusedId ? interior : null,
    viewport: size,
    free,
    flying,
    busy,
  })

  // Runs before drei's controls.update() (priority -1) so the polar clamp applies the same frame.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    let distance = camera.position.distanceTo(c.target)

    const f = flight.current
    if (f) {
      f.elapsed += delta
      const e = rebasedProgress(flightProgress(f.elapsed, f.duration), f.e0)
      distance = flightDistance(f.fromDistance, f.distance, e)
      // Pan tied to the zoom; move the camera with the target so the view direction holds.
      const u = remainingPan(f.fromDistance, f.distance, distance, e)
      const step = scratch.current.copy(f.target).lerp(f.from, u).sub(c.target)
      c.target.add(step)
      camera.position.add(step)
      const offset = scratch.current.copy(camera.position).sub(c.target).setLength(distance)
      camera.position.copy(c.target).add(offset)
      if (e >= 1) {
        flight.current = null
        flushMotion(c, camera)
      }
    } else if (hold.current && focusedId !== hold.current.stationId) {
      hold.current = null
    } else if (hold.current && !shouldReleaseHold(hold.current, distance, c.target)) {
      // An interrupted fly-to keeps its station focused until a deliberate zoom out or pan.
    } else {
      hold.current = null
      const cur = input.current
      cur.focusedId = focusedId
      cur.dismissedId = dismissedId
      cur.distance = distance
      cur.target = c.target
      cur.stations = network.stations
      // Cheap pre-check on the reused input; only a real change pays for a copied target and
      // a functional update, which re-runs the rules against the latest state.
      if (nextFocus(cur) !== cur) {
        updateFromCamera(distance, { x: c.target.x, z: c.target.z }, network.stations)
      }
    }

    const polar = tiltForDistance(distance)
    c.minPolarAngle = polar
    c.maxPolarAngle = polar
  }, -2)

  // Every on* handler passed to MapControls (onStart, onEnd, onChange) must stay referentially
  // stable: drei re-runs its connect effect when one changes, and that dispose() mid-drag drops the
  // document pointerup listener, leaving the controls stuck in a drag (no wheel, no pan) until
  // reload (underground-by0).
  const onStart = useCallback(() => {
    const f = flight.current
    const c = controls.current
    if (f && c && f.stationId !== null) {
      hold.current = {
        stationId: f.stationId,
        distance: camera.position.distanceTo(c.target),
        target: { x: c.target.x, z: c.target.z },
      }
    }
    flight.current = null
  }, [camera])

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      zoomToCursor
      minDistance={MIN_DISTANCE}
      maxDistance={maxDistance}
      onStart={onStart}
    />
  )
}
