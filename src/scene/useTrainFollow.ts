import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { createFollowView, followDistanceFor, followTargetInto, metersPerPx, writeFollowView } from '../lib/follow'
import { createFollowState, stepFollow, type FollowStepInput } from '../lib/followStep'
import type { Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { FollowAnchor } from '../lib/live/followAnchor'
import type { Ground } from '../lib/projection'
import { tiltForDistance } from '../lib/tilt'
import type { Destination, Flight, MapControlsImpl } from './cameraFlight'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

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
  following: boolean
  /** Changes on every explicit train pick: each one flies to the train again. */
  selections: number
  /** The selected train's length (meters): the follow flight pulls back until it fits the free width. */
  trainM: number
  /** Ends the follow (a pan); the train stays selected. */
  unfollow: () => void
}

/** CameraRig's side of the follow; all three stay referentially stable (underground-by0). */
export interface TrainFollow {
  /** At priority -2, before the flight step: the zoom anchor, a pending follow flight, and retargeting one in progress. */
  beforeFlight: () => void
  /** The camera follows a train: auto-focus doesn't enter, and the station orbit's pivot and pan clamp stand down. */
  active: () => boolean
  /** From the controls' start event: a new gesture's pan is counted from here. */
  onGestureStart: () => void
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
  following,
  selections,
  trainM,
  unfollow,
}: TrainFollowOptions): TrainFollow {
  const latest = useRef({ free, viewport, startFlight, unfollow, trainM })
  useLayoutEffect(() => {
    latest.current = { free, viewport, startFlight, unfollow, trainM }
  }, [free, viewport, startFlight, unfollow, trainM])
  const on = useRef(following)
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

  // The last gesture's pointer type: a touch gets the larger pan break.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: PointerEvent) => {
      input.current.touch = e.pointerType === 'touch'
    }
    el.addEventListener('pointerdown', onDown, { capture: true })
    return () => el.removeEventListener('pointerdown', onDown, { capture: true })
  }, [gl])

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
      // A re-select during the flight just retargets it.
      pending.current = false
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
      // The flight owns the camera; the frame after it ends measures from where it left the target.
      state.rebase = true
      state.baselined = false
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
    inp.reducedMotion = reduceMotion.matches
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

  return { beforeFlight, active, onGestureStart }
}
