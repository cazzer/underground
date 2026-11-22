import type { MapControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import type { Viewport } from '../lib/framing'
import { freeCenterShift, type ScreenRect, type ScreenShift } from '../lib/interiorCamera'
import {
  azimuthBounds,
  clampToDiscs,
  complexPanRadius,
  focusPoint,
  insideDiscs,
  nearestPoint,
  panClampArmed,
  PAN_RADIUS_BARE,
  panRadius,
  pivotShift,
  rotateArmed,
  screenOffsetTo,
  type AzimuthBounds,
  type AzimuthInput,
} from '../lib/orbitLimits'
import { markTurned } from '../lib/orbitTurned'
import type { Ground } from '../lib/projection'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { depthFactor, ISO_POLAR, tiltT } from '../lib/tilt'
import { addTurn, createTurnMeter, resetTurn } from '../lib/turnMeter'
import type { InteriorModel } from './interiorModel'
import { useTouchOrbit } from './useTouchOrbit'

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
  /** Every member's point of the focused station's complex, `focusPos` first; just `focusPos` for a lone station. */
  members: readonly Ground[]
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
 * `center`, or for a bare complex of its nearest member. An interior pivots on that middle too (where its fly-to
 * puts it); a bare station pivots on its own point (a complex on its nearest member), wherever it sits on screen.
 */
interface OrbitFocus {
  center: Ground
  /** The clamp's centers: [center], or a bare complex's members. */
  members: readonly Ground[]
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
  members,
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

  // A two-finger touch turns by twist (useTouchOrbit), never by the controls' own rotate. Its rule is the
  // mouse's below (inp.focused && rotating): holdAzimuth keeps an armed twist turning when the focus drops
  // mid-gesture while a train stays selected, as a right-drag does.
  const canTurn = useCallback(
    () => rotating.current && (focusRef.current !== null || following() || holdAzimuth()),
    [following, holdAzimuth],
  )
  const touch = useTouchOrbit({ controls, canTurn })
  const onGestureStart = useCallback(() => {
    const c = controls.current
    rotating.current = c !== null && rotateArmed(focusRef.current !== null || following(), tiltT(camera.position.distanceTo(c.target)))
    // Before this gesture's first move, which may come before the next frame's rule below.
    if (c && touch.isTouch()) c.rotateSpeed = 0
  }, [controls, camera, following, touch])
  const onGestureEnd = useCallback(() => {
    rotating.current = false
  }, [])

  const focus = useMemo<OrbitFocus | null>(() => {
    if (!focusPos) return null
    if (!interior) return { center: focusPos, members, radius: complexPanRadius(members), towardCamera: 0, bare: true }
    const a = interior.focusAnchor
    return { center: a.center, members: [a.center], radius: panRadius(a.reach), towardCamera: a.towardCamera, bare: false }
  }, [focusPos, members, interior])

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
    // turns nothing however its fingers drift, even after focus opens the window part-way through. A touch
    // never turns through it: its fingers' twist does (useTouchOrbit), so a pinch's drift turns nothing.
    c.rotateSpeed = inp.focused && rotating.current && !touch.isTouch() ? 1 : 0
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
      // A bare station pivots on its own point (a complex on its member nearest the free area's middle) while that is
      // within PAN_RADIUS_BARE of the middle; farther off (a held flight, a station focused at the edge) on that middle,
      // so a turn can't swing the view away.
      let ps = s
      if (f.bare) {
        const mid = focusPoint(c.target, s.right, s.toward, theta0, point.current)
        const at = nearestPoint(mid, f.members)
        if (Math.hypot(mid.x - at.x, mid.z - at.z) <= PAN_RADIUS_BARE) {
          screenOffsetTo(c.target, at, theta0, pivot.current)
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
    // A bare complex's clamp is the union of its members' discs (clampToDiscs).
    const inside = insideDiscs(p, f.members, f.radius)
    armed.current = panClampArmed(armed.current, armedFor.current === f.center, isBusy, tiltT(distance), inside)
    armedFor.current = f.center
    if (!armed.current) return
    const out = clamped.current
    if (!clampToDiscs(p, f.members, f.radius, delta, out)) return
    c.target.x += out.x - p.x
    c.target.z += out.z - p.z
    camera.position.x += out.x - p.x
    camera.position.z += out.z - p.z
  }, -0.5)

  return { onGestureStart, onGestureEnd }
}
