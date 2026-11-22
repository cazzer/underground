import type { MapControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import type { Viewport } from '../lib/framing'
import { freeCenterShift, type ScreenRect, type ScreenShift } from '../lib/interiorCamera'
import {
  azimuthBounds,
  focusPoint,
  panClampArmed,
  panRadius,
  pivotShift,
  rotateArmed,
  screenOffsetTo,
  softClampToRadius,
  type AzimuthBounds,
  type AzimuthInput,
} from '../lib/orbitLimits'
import { markTurned } from '../lib/orbitTurned'
import type { Ground } from '../lib/projection'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { depthFactor, ISO_POLAR, tiltT } from '../lib/tilt'
import { addTurn, createTurnMeter, resetTurn } from '../lib/turnMeter'
import type { InteriorModel } from './interiorModel'

type MapControlsImpl = ComponentRef<typeof MapControls>

const TAN_ISO = Math.tan(ISO_POLAR)
/**
 * Net turn (radians, from the azimuth when the station was focused, armed gestures only) that counts as the
 * visitor's first turn and retires the hint: about 17°.
 */
const TURN_SEEN = 0.3

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
  /** True while the camera follows a train: the view may turn as when focused (the follow pivots it on the train). */
  following: () => boolean
  /** True while a train is selected: its azimuth holds as when focused, followed or not. */
  holdAzimuth: () => boolean
}

/** Gesture hooks for the controls' start and end events; both stay referentially stable. */
export interface StationOrbitGestures {
  onGestureStart: () => void
  onGestureEnd: () => void
}

/**
 * What the view orbits and pans around. The pan clamp holds the free area's middle within `radius` of
 * `center`. An interior pivots on that middle too (where its fly-to puts it); a bare station pivots on its
 * own point, wherever it sits on screen.
 */
interface OrbitFocus {
  center: Ground
  radius: number
  /** Interior depth term at ISO_POLAR and full depth (FocusAnchor.towardCamera); 0 for a bare station. */
  towardCamera: number
  bare: boolean
}

/**
 * Station orbit: a turn window that opens with the tilt to a full spin while focused (a spring to
 * north-up otherwise), a turn that pivots on the focus point, and a soft pan radius once tilted. Only a
 * gesture armed at its start (rotateArmed) turns the view, and only its turning counts toward the HUD
 * hint. All frames write the controls imperatively: passing these as props or changing on* handlers would
 * re-run drei's connect effect and could lock the controls (underground-by0). Nothing here allocates per frame.
 */
export function useStationOrbit({
  controls,
  camera,
  focusPos,
  interior,
  viewport,
  free,
  flying,
  busy,
  following,
  holdAzimuth,
}: StationOrbitOptions): StationOrbitGestures {
  const input = useRef<AzimuthInput>({ theta: 0, focused: false, tilt: 0, dt: 0, reducedMotion: false })
  const bounds = useRef<AzimuthBounds>({ min: 0, max: 0 })
  const lastTheta = useRef(0)
  const shift = useRef<ScreenShift>({ right: 0, toward: 0 })
  const pivot = useRef<ScreenShift>({ right: 0, toward: 0 })
  const move = useRef<Ground>({ x: 0, z: 0 })
  const point = useRef<Ground>({ x: 0, z: 0 })
  const clamped = useRef<Ground>({ x: 0, z: 0 })
  const armed = useRef(false)
  const armedFor = useRef<Ground | null>(null)
  const turnedBy = useRef(createTurnMeter())
  const turnedFor = useRef<Ground | null>(null)
  const wasFlying = useRef(false)
  const rotating = useRef(false)
  /** Net turn over armed gestures while following a train (reset when the follow ends). */
  const followTurn = useRef(createTurnMeter())
  const focusRef = useRef(focusPos)
  useLayoutEffect(() => {
    focusRef.current = focusPos
  }, [focusPos])

  const onGestureStart = useCallback(() => {
    const c = controls.current
    rotating.current = c !== null && rotateArmed(focusRef.current !== null || following(), tiltT(camera.position.distanceTo(c.target)))
  }, [controls, camera, following])
  const onGestureEnd = useCallback(() => {
    rotating.current = false
  }, [])

  const focus = useMemo<OrbitFocus | null>(() => {
    if (!focusPos) return null
    if (!interior) return { center: focusPos, radius: panRadius(null), towardCamera: 0, bare: true }
    const a = interior.focusAnchor
    return { center: a.center, radius: panRadius(a.reach), towardCamera: a.towardCamera, bare: false }
  }, [focusPos, interior])

  // Before drei's controls.update() (priority -1), beside the polar lock in CameraRig.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    const inp = input.current
    inp.theta = c.getAzimuthalAngle()
    // A selected train holds the azimuth; clearing it with no station focused springs back to north-up.
    inp.focused = focusPos !== null || holdAzimuth() || following()
    inp.tilt = tiltT(camera.position.distanceTo(c.target))
    inp.dt = delta
    inp.reducedMotion = prefersReducedMotion()
    const b = azimuthBounds(inp, bounds.current)
    // enableRotate stays on: OrbitControls seeds a rotate only when it is on at gesture start, so
    // toggling it mid-gesture applied a stale start (a pinch into a station swung the view). The
    // window holds the angle when unfocused (min = max) and top-down (0); focused it opens with the
    // tilt, to ±Infinity (a full spin, which the controls leave unclamped) from FULL_SPIN_TILT.
    // rotateSpeed scales every move's delta, so a gesture not armed at its start (onGestureStart)
    // turns nothing however its fingers drift, even after focus opens the window part-way through.
    c.rotateSpeed = inp.focused && rotating.current ? 1 : 0
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
    if (following()) {
      // The follow pivots the turn on the train; an armed turn still counts as the visitor's first.
      if (rotating.current && theta !== theta0) {
        if (addTurn(followTurn.current, theta - theta0) > TURN_SEEN) markTurned()
      }
    } else resetTurn(followTurn.current)
    const f = focus
    if (!f) {
      armed.current = false
      turnedFor.current = null
      return
    }
    if (turnedFor.current !== focusPos) {
      turnedFor.current = focusPos
      resetTurn(turnedBy.current)
    }
    const isBusy = busy()
    const isFlying = flying()
    const s = shift.current
    const distance = camera.position.distanceTo(c.target)
    const polar = c.getPolarAngle()
    freeCenterShift(viewport, free, camera.fov, distance, polar, s)
    // The interior's mid-depth is drawn at the depth factor (StationInterior's scale.y), so its pivot shift is too.
    s.toward += (f.towardCamera * depthFactor(distance) * Math.tan(polar)) / TAN_ISO
    // The controls turned about the target; slide target and camera so the turn pivots on the focus point.
    // Not on a flight's landing frame either: its last step turned the camera (cameraFlight's turnOffset),
    // and pivoting that would slide the landed view off its framing.
    const landed = wasFlying.current
    wasFlying.current = isFlying
    if (!isFlying && !landed && theta !== theta0) {
      // A bare station pivots on its own point while it is within its pan radius of the free area's middle;
      // farther off (a held flight, a station focused at the edge) on that middle, so a turn can't swing the view away.
      let ps = s
      if (f.bare) {
        const mid = focusPoint(c.target, s.right, s.toward, theta0, point.current)
        if (Math.hypot(mid.x - f.center.x, mid.z - f.center.z) <= f.radius) {
          screenOffsetTo(c.target, f.center, theta0, pivot.current)
          ps = pivot.current
        }
      }
      if (rotating.current) {
        if (addTurn(turnedBy.current, theta - theta0) > TURN_SEEN) markTurned()
      }
      const m = pivotShift(ps.right, ps.toward, theta0, theta, move.current)
      c.target.x += m.x
      c.target.z += m.z
      camera.position.x += m.x
      camera.position.z += m.z
    }
    const p = focusPoint(c.target, s.right, s.toward, theta, point.current)
    const inside = Math.hypot(p.x - f.center.x, p.z - f.center.z) <= f.radius
    armed.current = panClampArmed(armed.current, armedFor.current === f.center, isBusy, tiltT(distance), inside)
    armedFor.current = f.center
    if (!armed.current) return
    const out = clamped.current
    if (!softClampToRadius(p, f.center, f.radius, delta, out)) return
    c.target.x += out.x - p.x
    c.target.z += out.z - p.z
    camera.position.x += out.x - p.x
    camera.position.z += out.z - p.z
  }, -0.5)

  return { onGestureStart, onGestureEnd }
}
