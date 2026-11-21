import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { useFocus } from '../lib/focus'
import { shouldReleaseHold, type FocusHold } from '../lib/focusHold'
import { nextFocus, type FocusInput } from '../lib/focusMachine'
import { flightDistance, flightDuration, flightProgress, rebasedProgress, remainingPan } from '../lib/flight'
import { frameBounds, type Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { tiltForDistance } from '../lib/tilt'
import { flushMotion, interiorFlight, pointFlight, stationFlight, turnOffset, type Flight, type MapControlsImpl } from './cameraFlight'
import type { InteriorModel } from './interiorModel'
import { useStationOrbit } from './useStationOrbit'

const MIN_DISTANCE = 40
/** How far past the fitted city overview the user may zoom out. */
const MAX_ZOOM_OUT = 1.3

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
        fromAzimuth: c.getAzimuthalAngle(),
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
        : stationFlight(station.id, station.pos, l.size, l.insets, l.panel, camera.fov, c.getAzimuthalAngle())
    const fromDistance = camera.position.distanceTo(c.target)
    flight.current = {
      ...dest,
      from: c.target.clone(),
      fromDistance,
      fromAzimuth: c.getAzimuthalAngle(),
      elapsed: 0,
      duration: flightDuration(fromDistance, dest.distance),
      e0: 0,
    }
  }, [flyRequest, network, camera])

  // The interior (first visit) or the panel's measurement (it grows as arrivals fill in) can land
  // mid-flight: retarget that flight's destination. It rebases on the camera's current pose and keeps
  // the timing, so the camera doesn't jump. Focus reached by zooming has no flight, and the camera
  // never moves on its own.
  useEffect(() => {
    const f = flight.current
    const c = controls.current
    if (!c || !f || f.stationId === null) return
    const station = network.stationById.get(f.stationId)
    if (!station) return
    const az = c.getAzimuthalAngle()
    const dest =
      interior?.stationId === f.stationId
        ? interiorFlight(interior, size, insets, panel, camera.fov, az)
        : stationFlight(station.id, station.pos, size, insets, panel, camera.fov, az)
    f.from.copy(c.target)
    f.fromDistance = camera.position.distanceTo(c.target)
    f.fromAzimuth = az
    f.e0 = flightProgress(f.elapsed, f.duration)
    f.target = dest.target
    f.distance = dest.distance
    f.azimuth = dest.azimuth
  }, [interior, panel, size, insets, camera, network])

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
      turnOffset(offset, f, e)
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
