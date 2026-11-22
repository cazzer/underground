import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { createFollowView, followDistanceFor, followTargetInto, metersPerPx, writeFollowView } from '../lib/follow'
import { flightProgress } from '../lib/flight'
import { createFollowState, observeTrain, stepFollow, type FollowStepInput } from '../lib/followStep'
import type { Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { consistFor } from '../lib/live/consist'
import type { FollowAnchor } from '../lib/live/followAnchor'
import type { Ground } from '../lib/projection'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { tiltForDistance } from '../lib/tilt'
import { useTrainSelection } from '../lib/trainSelection'
import type { Destination, Flight, MapControlsImpl } from './cameraFlight'

interface TrainFollowOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  /** Starts a flight (CameraRig's: clears the focus hold, flushes the controls' motion). Stable. */
  startFlight: (dest: Destination) => void
  /** The selected train's drawn point, written each frame at priority -3 (LiveTrains). */
  anchor: FollowAnchor
  /** The screen area the HUD leaves free; the train is kept in its middle. */
  free: ScreenRect
  viewport: Viewport
}

/** CameraRig's side of the follow; all three stay referentially stable (underground-by0). */
export interface TrainFollow {
  /** At priority -2, before the flight step: the zoom anchor, a pending follow flight, and retargeting one in progress. */
  beforeFlight: () => void
  /** The camera follows a train: auto-focus doesn't enter, and the station orbit's pivot and pan clamp stand down. */
  active: () => boolean
  /** From the controls' start event: a new gesture's pan is counted from here. */
  onGestureStart: () => void
  /** A train is selected: the orbit holds its azimuth as for a focused station, so ending a follow doesn't spin the map. */
  holdAzimuth: () => boolean
}

/**
 * Keeps the selected train in the middle of the free area. A selection (or the Follow button) flies there, retargeted
 * every frame as the train moves. Then each frame, after the controls' update (-1) and before the orbit's pivot (-0.5),
 * stepFollow (followStep.ts) moves target and camera by one step: onto the train through a short lag, so a wheel zoom
 * or a turn keeps it there (zoom-to-cursor is off while following) while a lurch is rounded off, and a pan past the
 * break threshold ends the follow. Nothing here allocates per frame.
 */
export function useTrainFollow({
  controls,
  camera,
  flight,
  startFlight,
  anchor,
  free,
  viewport,
}: TrainFollowOptions): TrainFollow {
  // Every explicit pick (`selections`) flies to the train again; the selected train's consist sets how far it pulls
  // back; a pan calls `unfollow` (the train stays selected).
  const { following, selections, unfollow, selectedKey, selectedSummary } = useTrainSelection()
  const selected = selectedKey !== null
  const consist = consistFor(selectedSummary?.routeId ?? null)
  const trainM = consist.cars * consist.pitchM
  const latest = useRef({ free, viewport, startFlight, unfollow, trainM })
  useLayoutEffect(() => {
    latest.current = { free, viewport, startFlight, unfollow, trainM }
  }, [free, viewport, startFlight, unfollow, trainM])
  const on = useRef(following)
  const isSelected = useRef(selected)
  useLayoutEffect(() => {
    isSelected.current = selected
  }, [selected])
  const holdAzimuth = useCallback(() => isSelected.current, [])
  /** A follow flight to start once the anchor is valid and no other flight is under way. */
  const pending = useRef(false)
  const state = useMemo(createFollowState, [])
  const lastFree = useRef<ScreenRect | null>(null)
  const view = useMemo(createFollowView, [])
  const aim = useRef<Ground>({ x: 0, z: 0 })
  const next = useRef<Ground>({ x: 0, z: 0 })
  const input = useRef<FollowStepInput>({
    target: { x: 0, z: 0 },
    train: null,
    view: createFollowView(),
    metersPerPx: 1,
    dt: 0,
    cut: false,
    freeChanged: false,
    touch: false,
    reducedMotion: false,
  })

  // The last gesture's pointer type: a touch gets the larger pan break. On the element the controls listen on (drei's
  // choice), so a gesture that starts on an Html label counts too.
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected as HTMLElement | undefined)
  useEffect(() => {
    const el = connected ?? gl.domElement
    const onDown = (e: PointerEvent) => {
      input.current.touch = e.pointerType === 'touch'
    }
    el.addEventListener('pointerdown', onDown, { capture: true })
    return () => el.removeEventListener('pointerdown', onDown, { capture: true })
  }, [gl, connected])

  useLayoutEffect(() => {
    on.current = following
    pending.current = following
    state.rebase = true
    state.baselined = false
    state.panPx = 0
  }, [following, selections, state])

  /** The ground target that puts the train mid-free for a camera at `distance` (tilted for it) at its current azimuth. */
  const aimFor = useCallback(
    (c: MapControlsImpl, distance: number, polar: number): Ground => {
      const l = latest.current
      writeFollowView(view, l.viewport, l.free, camera.fov, distance, polar, c.getAzimuthalAngle())
      return followTargetInto(anchor, view, aim.current)
    },
    [view, camera, anchor],
  )

  const beforeFlight = useCallback(() => {
    const c = controls.current
    if (!c) return
    // Zoom about the target, which the follow keeps on the train; toward the cursor would pan the view off it.
    c.zoomToCursor = !on.current
    if (!on.current || !anchor.valid) return
    const f = flight.current
    if (f?.follows) {
      if (pending.current) {
        // A re-select during the flight: rebase it from here onto the new train's fit distance, keeping its timing.
        pending.current = false
        const l = latest.current
        f.e0 = flightProgress(f.elapsed, f.duration)
        f.from.copy(c.target)
        f.fromDistance = camera.position.distanceTo(c.target)
        f.fromAzimuth = c.getAzimuthalAngle()
        f.distance = followDistanceFor(l.trainM, l.viewport, l.free, camera.fov)
      }
      const g = aimFor(c, f.distance, tiltForDistance(f.distance))
      f.target.set(g.x, 0, g.z)
    } else if (pending.current && !f) {
      // Not over another flight: a location flight's unfollow may still be on its way.
      pending.current = false
      const l = latest.current
      const distance = followDistanceFor(l.trainM, l.viewport, l.free, camera.fov)
      const g = aimFor(c, distance, tiltForDistance(distance))
      l.startFlight({ stationId: null, target: new Vector3(g.x, 0, g.z), distance, azimuth: null, follows: true })
    }
  }, [controls, flight, anchor, aimFor, camera])

  const active = useCallback(() => on.current, [])

  const onGestureStart = useCallback(() => {
    const c = controls.current
    state.panPx = 0
    if (!c) return
    state.last.x = c.target.x
    state.last.z = c.target.z
    state.baselined = true
  }, [controls, state])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c || !on.current) return
    if (flight.current) {
      // The flight owns the camera; the frame after it ends measures from where it left the target, and starts the lag
      // at the speed the train is seen moving now.
      state.rebase = true
      state.baselined = false
      observeTrain(state, anchor.valid ? anchor : null, dt, anchor.cut)
      return
    }
    const l = latest.current
    const t = c.target
    const distance = camera.position.distanceTo(t)
    const inp = input.current
    inp.target.x = t.x
    inp.target.z = t.z
    inp.train = anchor.valid ? anchor : null
    writeFollowView(inp.view, l.viewport, l.free, camera.fov, distance, c.getPolarAngle(), c.getAzimuthalAngle())
    inp.metersPerPx = metersPerPx(distance, camera.fov, l.viewport.height)
    inp.dt = dt
    inp.cut = anchor.cut
    inp.freeChanged = lastFree.current !== l.free
    inp.reducedMotion = prefersReducedMotion()
    lastFree.current = l.free
    const out = next.current
    const result = stepFollow(state, inp, out)
    if (result === 'break') {
      // Leave the view where the pan put it; the state catches up on the next render.
      on.current = false
      pending.current = false
      l.unfollow()
    } else if (result === 'refly') {
      // The train reappeared far off (a cross-fade's unseen move): fly there at this zoom.
      l.startFlight({ stationId: null, target: new Vector3(out.x, 0, out.z), distance, azimuth: null, follows: true })
    } else if (result === 'move') {
      camera.position.x += out.x - t.x
      camera.position.z += out.z - t.z
      t.x = out.x
      t.z = out.z
    }
  }, -0.75)

  return { beforeFlight, active, onGestureStart, holdAzimuth }
}
