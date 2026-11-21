import type { MapControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ComponentRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import type { Viewport } from '../lib/framing'
import { freeCenterShift, type ScreenRect, type ScreenShift } from '../lib/interiorCamera'
import {
  azimuthBounds,
  focusPoint,
  panClampArmed,
  panRadius,
  pivotShift,
  softClampToRadius,
  type AzimuthBounds,
  type AzimuthInput,
} from '../lib/orbitLimits'
import type { Ground } from '../lib/projection'
import { ISO_POLAR } from '../lib/tilt'
import type { InteriorModel } from './interiorModel'
import { orbitLook } from './orbitLook'

type MapControlsImpl = ComponentRef<typeof MapControls>

const TAN_ISO = Math.tan(ISO_POLAR)

interface StationOrbitOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  /** The focused station's ground position, or null when nothing is focused. */
  focusPos: Ground | null
  /** The focused station's interior once loaded (null otherwise). */
  interior: InteriorModel | null
  viewport: Viewport
  /** The screen area the HUD leaves free (interiorFreeRect). */
  free: ScreenRect
  /** True during a fly-to: the flight owns the camera, so a turn doesn't pivot. */
  flying: () => boolean
  /** True during a fly-to or an interrupted-flight focus hold: the pan clamp stays off. */
  busy: () => boolean
}

/** What the view orbits and pans around: the interior's plan (pivoting on the free area's middle) or the bare station. */
interface OrbitFocus {
  center: Ground
  radius: number
  /** Interior depth term at ISO_POLAR (FocusAnchor.towardCamera); 0 for a bare station. */
  towardCamera: number
  /** Pivot on the free area's middle (where an interior fly-to puts it) rather than the view center. */
  useFree: boolean
}

/**
 * Station orbit: azimuth window, a turn that pivots on the focus point, and a soft pan radius. All
 * frames write the controls imperatively: passing these as props or on* handlers would re-run drei's
 * connect effect and could lock the controls (underground-by0). Nothing here allocates per frame.
 */
export function useStationOrbit({ controls, camera, focusPos, interior, viewport, free, flying, busy }: StationOrbitOptions): void {
  const input = useRef<AzimuthInput>({ theta: 0, focused: false, distance: 0, limit: orbitLook.limit, dt: 0 })
  const bounds = useRef<AzimuthBounds>({ min: 0, max: 0 })
  const lastTheta = useRef(0)
  const shift = useRef<ScreenShift>({ right: 0, toward: 0 })
  const move = useRef<Ground>({ x: 0, z: 0 })
  const point = useRef<Ground>({ x: 0, z: 0 })
  const clamped = useRef<Ground>({ x: 0, z: 0 })
  const armed = useRef(false)
  const armedFor = useRef<Ground | null>(null)

  const focus = useMemo<OrbitFocus | null>(() => {
    if (!focusPos) return null
    if (!interior) return { center: focusPos, radius: panRadius(null), towardCamera: 0, useFree: false }
    const a = interior.focusAnchor
    return { center: a.center, radius: panRadius(a.halfExtent), towardCamera: a.towardCamera, useFree: true }
  }, [focusPos, interior])

  // Before drei's controls.update() (priority -1), beside the polar lock in CameraRig.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    const inp = input.current
    inp.theta = c.getAzimuthalAngle()
    inp.focused = focusPos !== null
    inp.distance = camera.position.distanceTo(c.target)
    inp.dt = delta
    const b = azimuthBounds(inp, bounds.current)
    // enableRotate stays on: OrbitControls seeds a rotate only when it is on at gesture start, so
    // toggling it mid-gesture applied a stale start (a pinch into a station swung the view). The
    // window alone holds the angle when unfocused (min = max) and top-down (0).
    // Safe mid-gesture: OrbitControls updates rotateStart on every move whatever the speed, so no
    // stale start; and at 0 no sphericalDelta accumulates while the window is shut, so a drifting
    // pinch can't replay as a turn once focus opens the window.
    c.rotateSpeed = inp.focused ? 1 : 0
    c.minAzimuthAngle = b.min
    c.maxAzimuthAngle = b.max
  }, -2)

  // After update(), before render. Never above 0: a positive priority takes over rendering.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    const theta = c.getAzimuthalAngle()
    const theta0 = lastTheta.current
    lastTheta.current = theta
    const f = focus
    if (!f) {
      armed.current = false
      return
    }
    const isBusy = busy()
    const isFlying = flying()
    const s = shift.current
    if (f.useFree) {
      const polar = c.getPolarAngle()
      freeCenterShift(viewport, free, camera.fov, camera.position.distanceTo(c.target), polar, s)
      s.toward += (f.towardCamera * Math.tan(polar)) / TAN_ISO
    } else {
      s.right = 0
      s.toward = 0
    }
    // The controls turned about the target; slide target and camera so the turn pivots on the focus point.
    if (!isFlying && theta !== theta0) {
      const m = pivotShift(s.right, s.toward, theta0, theta, move.current)
      c.target.x += m.x
      c.target.z += m.z
      camera.position.x += m.x
      camera.position.z += m.z
    }
    const p = focusPoint(c.target, s.right, s.toward, theta, point.current)
    const inside = Math.hypot(p.x - f.center.x, p.z - f.center.z) <= f.radius
    armed.current = panClampArmed(armed.current, armedFor.current === f.center, isBusy, inside)
    armedFor.current = f.center
    if (!armed.current) return
    const out = clamped.current
    if (!softClampToRadius(p, f.center, f.radius, delta, out)) return
    c.target.x += out.x - p.x
    c.target.z += out.z - p.z
    camera.position.x += out.x - p.x
    camera.position.z += out.z - p.z
  }, -0.5)
}
