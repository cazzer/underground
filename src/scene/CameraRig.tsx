import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { useFocus } from '../lib/focus'
import { shouldReleaseHold, type FocusHold } from '../lib/focusHold'
import { nextFocus, type FocusInput } from '../lib/focusMachine'
import { frameBounds, type Insets, type Viewport } from '../lib/framing'
import { frameInterior, interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { tiltForDistance } from '../lib/tilt'
import type { InteriorModel } from './interiorModel'

type MapControlsImpl = ComponentRef<typeof MapControls>

const MIN_DISTANCE = 40
/** How far past the fitted city overview the user may zoom out. */
const MAX_ZOOM_OUT = 1.3
/** Camera distance after clicking a station: inside the fully-tilted range. */
const FOCUS_DISTANCE = 170

interface Flight {
  stationId: string
  target: Vector3
  distance: number
}

/** Fly-to that centers the interior in the screen area the HUD leaves free, at full reveal. */
function interiorFlight(model: InteriorModel, viewport: Viewport, insets: Insets, panel: ScreenRect | null, fovDeg: number): Flight {
  const free = interiorFreeRect(viewport, insets, panel)
  const { distance, target } = frameInterior({ center: model.focusCenter, viewport, free, fovDeg })
  return { stationId: model.stationId, target: new Vector3(target.x, 0, target.z), distance }
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
  const latest = useRef({ interior, panel, size, insets })
  useLayoutEffect(() => {
    latest.current = { interior, panel, size, insets }
  }, [interior, panel, size, insets])

  // Layout effect, not a passive one: a frame between the select and a passive effect would see
  // the new focus with no flight and drop it again (the camera is still far out).
  useLayoutEffect(() => {
    if (!flyRequest) return
    const station = network.stationById.get(flyRequest.stationId)
    if (!station) throw new Error(`Fly request for unknown station "${flyRequest.stationId}"`)
    hold.current = null
    const l = latest.current
    flight.current =
      l.interior?.stationId === station.id
        ? interiorFlight(l.interior, l.size, l.insets, l.panel, camera.fov)
        : { stationId: station.id, target: new Vector3(station.pos.x, 0, station.pos.z), distance: FOCUS_DISTANCE }
  }, [flyRequest, network, camera])

  // The interior (first visit) or the panel's measurement can land mid-flight: retarget that
  // flight. Focus reached by zooming has no flight, and the camera never moves on its own.
  useEffect(() => {
    if (interior && flight.current?.stationId === interior.stationId) {
      flight.current = interiorFlight(interior, size, insets, panel, camera.fov)
    }
  }, [interior, panel, size, insets, camera])

  // Runs before drei's controls.update() (priority -1) so the polar clamp applies the same frame.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    let distance = camera.position.distanceTo(c.target)

    const f = flight.current
    if (f) {
      const k = 1 - Math.exp(-delta * 4)
      const step = scratch.current.copy(f.target).sub(c.target).multiplyScalar(k)
      c.target.add(step)
      camera.position.add(step)
      distance += (f.distance - distance) * k
      const offset = scratch.current.copy(camera.position).sub(c.target).setLength(distance)
      camera.position.copy(c.target).add(offset)
      if (c.target.distanceTo(f.target) < 0.5 && Math.abs(distance - f.distance) < 1) flight.current = null
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

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableRotate={false}
      enableDamping
      zoomToCursor
      minDistance={MIN_DISTANCE}
      maxDistance={maxDistance}
      onStart={() => {
        const f = flight.current
        const c = controls.current
        if (f && c) {
          hold.current = {
            stationId: f.stationId,
            distance: camera.position.distanceTo(c.target),
            target: { x: c.target.x, z: c.target.z },
          }
        }
        flight.current = null
      }}
    />
  )
}
