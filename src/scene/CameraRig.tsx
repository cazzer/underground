import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { interiorCovers, type IndexLoad } from '../data/interiorLoad'
import { useStationStreets } from '../data/useStationStreets'
import { useFocus } from '../lib/focus'
import { newDwell, settled } from '../lib/focusDwell'
import { groupPositions, shouldReleaseHold, type FocusHold } from '../lib/focusHold'
import { NO_FOCUS_GROUP, nextFocus, type FocusInput } from '../lib/focusMachine'
import { flightDistance, flightProgress, rebasedProgress, remainingPan } from '../lib/flight'
import { frameBounds, type Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { AwaitingInterior } from '../lib/interiorReframe'
import type { FollowAnchor } from '../lib/live/followAnchor'
import type { Network } from '../lib/network'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { tiltForDistance } from '../lib/tilt'
import { flushMotion, newFlight, turnOffset, type Destination, type Flight, type MapControlsImpl } from './cameraFlight'
import type { InteriorModel } from './interiorModel'
import { useFocusGroups } from './useFocusGroups'
import { useInteriorReframe } from './useInteriorReframe'
import { useStationFlights } from './useStationFlights'
import { useStationOrbit } from './useStationOrbit'
import { useTrainFollow } from './useTrainFollow'

const MIN_DISTANCE = 40
/** How far past the fitted city overview the user may zoom out. */
const MAX_ZOOM_OUT = 1.3

interface CameraRigProps {
  network: Network
  /** HUD-covered bands; the opening view fits the city between them. */
  insets: Insets
  /** The focused station's interior once loaded; a click on that station frames it instead. */
  interior: InteriorModel | null
  /** The station index: the focused and the closed station's complexes come from it. */
  index: IndexLoad
  /** The station panel's screen rect, kept clear when framing an interior. */
  panel: ScreenRect | null
  /** The selected train's drawn point (LiveTrains writes it at -3): the camera follows it. */
  anchor: FollowAnchor
}

export function CameraRig({ network, insets, interior, index, panel, anchor }: CameraRigProps) {
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
    settled: false,
    focusGroup: NO_FOCUS_GROUP,
    dismissedGroup: NO_FOCUS_GROUP,
  })
  const focusGroup = useFocusGroups(input, index, interior, focusedId, dismissedId)
  // Auto-focus enters only once the view has held still (focusDwell.ts); a gesture in progress never has.
  const dwell = useRef(newDwell())
  const gesture = useRef(false)
  /** A gesture ended since the last frame: that frame restarts the wait too, however long frames take. */
  const gestureEnded = useRef(false)
  /** A station flight that set off before its interior (or bare streets) was known: reframed after landing (useInteriorReframe). */
  const awaiting = useRef<AwaitingInterior | null>(null)

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
  // onStart reads `network` here too, so it stays referentially stable (underground-by0).
  const streets = useStationStreets(focusedId)
  const latest = useRef({ interior, panel, size, insets, maxDistance, network, streets, index })
  useLayoutEffect(() => {
    latest.current = { interior, panel, size, insets, maxDistance, network, streets, index }
  }, [interior, panel, size, insets, maxDistance, network, streets, index])

  useStationFlights({ controls, camera, flight, hold, awaiting, layout: latest, network, flyRequest, interior, panel, size, insets, streets, index })

  const focusPos = (focusedId && network.stationById.get(focusedId)?.pos) || null
  const free = useMemo(() => interiorFreeRect(size, insets, panel), [size, insets, panel])
  const startFlight = useCallback(
    (dest: Destination) => {
      const c = controls.current
      if (!c) return
      hold.current = null
      awaiting.current = null
      flushMotion(c, camera)
      flight.current = newFlight(dest, c, camera, prefersReducedMotion())
    },
    [camera],
  )
  const follow = useTrainFollow({ controls, camera, flight, startFlight, anchor, free, viewport: size })
  // While following, the follow owns the target: the orbit neither pivots nor clamps the pan.
  const flying = useCallback(() => flight.current !== null || follow.active(), [follow.active])
  const busy = useCallback(() => flight.current !== null || hold.current !== null || follow.active(), [follow.active])
  const { onGestureStart, onGestureEnd } = useStationOrbit({
    controls,
    camera,
    focusPos,
    interior: interiorCovers(interior, focusedId) ? interior : null,
    viewport: size,
    free,
    flying,
    busy,
    following: follow.active,
    holdAzimuth: follow.holdAzimuth,
  })
  const landed = useInteriorReframe({ controls, camera, flight, awaiting, layout: latest, interior, streets, index, focusedId, following: follow.active })

  // Runs before drei's controls.update() (priority -1) so the polar clamp applies the same frame.
  useFrame((state, delta) => {
    const c = controls.current
    if (!c) return
    follow.beforeFlight()
    let distance = camera.position.distanceTo(c.target)
    const still = settled(dwell.current, state.clock.elapsedTime, c.target, distance, gesture.current || gestureEnded.current)
    gestureEnded.current = false

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
        landed()
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
      // Following a train past stations never pops their panels; exits still apply.
      cur.settled = still && !follow.active()
      // Cheap pre-check on the reused input; only a real change pays for a copied target and
      // a functional update, which re-runs the rules against the latest state.
      if (nextFocus(cur) !== cur) {
        updateFromCamera(distance, { x: c.target.x, z: c.target.z }, network.stations, cur.settled, cur.focusGroup, cur.dismissedGroup)
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
    const station = f?.stationId != null ? latest.current.network.stationById.get(f.stationId) : undefined
    if (f && c && station) {
      hold.current = {
        stationId: station.id,
        station: station.pos,
        distance: camera.position.distanceTo(c.target),
        target: { x: c.target.x, z: c.target.z },
        members: groupPositions(focusGroup.current, latest.current.network.stationById),
      }
    }
    flight.current = null
    awaiting.current = null
    gesture.current = true
    onGestureStart()
    follow.onGestureStart()
  }, [camera, onGestureStart, follow.onGestureStart])
  const onEnd = useCallback(() => {
    gesture.current = false
    gestureEnded.current = true
    onGestureEnd()
  }, [onGestureEnd])

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      minDistance={MIN_DISTANCE}
      maxDistance={maxDistance}
      onStart={onStart}
      onEnd={onEnd}
    />
  )
}
