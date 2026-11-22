import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import {
  anchorJumped,
  createFollowView,
  decayCatch,
  FOLLOW_DISTANCE,
  followTargetInto,
  metersPerPx,
  panBroke,
  writeFollowView,
} from '../lib/follow'
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
 * Keeps the selected train in the middle of the free area. A selection (or the Follow button) flies there at the
 * landing distance, retargeted every frame as the train moves. Then each frame, after the controls' update (-1) and
 * before the orbit's pivot (-0.5), target and camera move by the same step so the train's drawn point sits on that
 * screen point again: a wheel zoom or a turn keeps it there (zoom-to-cursor is off while following), and a discontinuity
 * (a panel resize, a flight cut short, a cross-fade) is taken up by a catch-up offset that eases out. A pan of
 * FOLLOW_BREAK_PX in one gesture ends the follow. Nothing here allocates per frame.
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
  unfollow,
}: TrainFollowOptions): TrainFollow {
  const latest = useRef({ free, viewport, startFlight, unfollow })
  useLayoutEffect(() => {
    latest.current = { free, viewport, startFlight, unfollow }
  }, [free, viewport, startFlight, unfollow])
  const on = useRef(following)
  /** A follow flight to start once the anchor is valid. */
  const pending = useRef(false)
  /** The next follow frame takes the camera's offset from the train as its catch-up (after a flight, an invalid anchor). */
  const rebase = useRef(true)
  const lastFree = useRef<ScreenRect | null>(null)
  const view = useMemo(createFollowView, [])
  const aim = useRef<Ground>({ x: 0, z: 0 })
  const catchUp = useRef<Ground>({ x: 0, z: 0 })
  /** Where the target was left last frame (or at the gesture start); the controls' pan moves it from there. */
  const lastSet = useRef<Ground>({ x: 0, z: 0 })
  const baselined = useRef(false)
  const panPx = useRef(0)

  useLayoutEffect(() => {
    on.current = following
    pending.current = following
    rebase.current = true
    baselined.current = false
    panPx.current = 0
  }, [following, selections])

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
    if (pending.current) {
      pending.current = false
      const g = aimFor(c, FOLLOW_DISTANCE, tiltForDistance(FOLLOW_DISTANCE))
      latest.current.startFlight({ stationId: null, target: new Vector3(g.x, 0, g.z), distance: FOLLOW_DISTANCE, azimuth: null, follows: true })
    } else if (f?.follows) {
      const g = aimFor(c, f.distance, tiltForDistance(f.distance))
      f.target.set(g.x, 0, g.z)
    }
  }, [controls, flight, anchor, aimFor])

  const active = useCallback(() => on.current, [])

  const onGestureStart = useCallback(() => {
    const c = controls.current
    panPx.current = 0
    if (!c) return
    lastSet.current.x = c.target.x
    lastSet.current.z = c.target.z
    baselined.current = true
  }, [controls])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c || !on.current) return
    if (flight.current) {
      // The flight owns the camera; the frame after it ends measures from where it left the target.
      rebase.current = true
      baselined.current = false
      return
    }
    const l = latest.current
    const t = c.target
    const distance = camera.position.distanceTo(t)
    const mpp = metersPerPx(distance, camera.fov, l.viewport.height)
    // Between our last write and now only the controls' pan moved the target (zoom is about it, a turn keeps it).
    if (baselined.current) panPx.current += Math.hypot(t.x - lastSet.current.x, t.z - lastSet.current.z) / mpp
    baselined.current = true
    lastSet.current.x = t.x
    lastSet.current.z = t.z
    if (panBroke(panPx.current)) {
      // Leave the view where the pan put it; the state catches up on the next render.
      on.current = false
      pending.current = false
      l.unfollow()
      return
    }
    if (!anchor.valid) {
      rebase.current = true
      return
    }
    const g = aimFor(c, distance, c.getPolarAngle())
    const k = catchUp.current
    if (rebase.current || anchor.cut || lastFree.current !== l.free) {
      k.x = t.x - g.x
      k.z = t.z - g.z
      if (anchor.cut && !rebase.current && anchorJumped(Math.hypot(k.x, k.z), mpp)) {
        // The train reappeared far off (a cross-fade's unseen move): fly there at this zoom.
        l.startFlight({ stationId: null, target: new Vector3(g.x, 0, g.z), distance, azimuth: null, follows: true })
        return
      }
      rebase.current = false
      lastFree.current = l.free
    }
    decayCatch(k, dt, reduceMotion.matches)
    const dx = g.x + k.x - t.x
    const dz = g.z + k.z - t.z
    t.x += dx
    t.z += dz
    camera.position.x += dx
    camera.position.z += dz
    lastSet.current.x = t.x
    lastSet.current.z = t.z
  }, -0.75)

  return { beforeFlight, active, onGestureStart }
}
