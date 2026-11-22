import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { Vector3 } from 'three'
import type { OrbitProbe } from '../lib/focus'
import { clampAzimuth, createTouchOrbit, takeTurn, touchDown, touchMove, touchReset, touchUp, type TouchOrbit } from '../lib/touchOrbit'
import type { MapControlsImpl } from './cameraFlight'
import { twistLook } from './twistLook'

interface TouchOrbitOptions {
  controls: RefObject<MapControlsImpl | null>
  /** Whether the current gesture may turn the view (armed at its start, and still focused or following). */
  canTurn: () => boolean
}

export interface TouchOrbitHandle {
  /** True when the last gesture began with a touch. */
  isTouch: () => boolean
}

/** What the listeners and the frame share; one per hook, mutated in place. */
interface TwistRun {
  t: TouchOrbit
  /** The azimuth the lock steers to: unwrapped, clamped to the controls' window. */
  goal: number
  /** A move changed the goal since the last frame applied it. */
  due: boolean
  /** The controls whose zoomSpeed the lock holds at 0, and the value to restore. */
  held: MapControlsImpl | null
  heldZoom: number
}

/** TEMPORARY (twistLook.ts): under `?twist=both` a rotate lock keeps zooming. */
const holdZoom = twistLook === 'lock'

/**
 * Two-finger twist to orbit (lib/touchOrbit.ts). The controls still zoom a two-finger touch but never turn it
 * (useStationOrbit holds their rotateSpeed at 0 for touch); this follows the two live touches on the element the
 * controls listen on and, once a gesture locks to rotate, holds the controls' zoom (zoomSpeed 0, restored when the
 * lock ends; a wheel then doesn't zoom either) and steers the azimuth. Moves only move the goal; a frame at -2,
 * before drei's update(), applies it once through setAzimuthalAngle, whose damping keeps the controls' lag and glide
 * at the same pace whatever the touch event rate. No props or on* handlers of the controls change (underground-by0).
 * Its pointerdown listens in the capture phase, before the controls' own, so onGestureStart knows the pointer type;
 * its pointermove is on the element, before the controls' document listener, so a lock lands before that move's dolly.
 */
export function useTouchOrbit({ controls, canTurn }: TouchOrbitOptions): TouchOrbitHandle {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const connected = useThree((s) => s.events.connected as HTMLElement | undefined)
  const touch = useRef(false)
  const run = useRef<TwistRun>({ t: createTouchOrbit(), goal: 0, due: false, held: null, heldZoom: 1 })
  const canTurnRef = useRef(canTurn)
  useLayoutEffect(() => {
    canTurnRef.current = canTurn
  }, [canTurn])

  useEffect(() => {
    const el = connected ?? gl.domElement
    const r = run.current
    const t = r.t
    touchReset(t)
    const release = () => {
      if (r.held) r.held.zoomSpeed = r.heldZoom
      r.held = null
    }
    const onDown = (e: PointerEvent) => {
      touch.current = e.pointerType === 'touch'
      if (!touch.current) return
      if (e.isPrimary) touchReset(t)
      touchDown(t, e.pointerId, e.clientX, e.clientY)
      if (t.lock !== 'rotate') release()
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const c = controls.current
      if (!c) return
      const was = t.lock
      touchMove(t, e.pointerId, e.clientX, e.clientY, canTurnRef.current())
      if (t.lock !== 'rotate') return
      const theta = c.getAzimuthalAngle()
      if (was !== 'rotate') {
        r.goal = theta
        if (holdZoom) {
          r.held = c
          r.heldZoom = c.zoomSpeed
          c.zoomSpeed = 0
        }
      }
      const turn = takeTurn(t, el.clientHeight)
      if (turn === 0) return
      r.goal = clampAzimuth(r.goal + turn, theta, c.minAzimuthAngle, c.maxAzimuthAngle)
      r.due = true
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touchUp(t, e.pointerId)
      if (t.lock !== 'rotate') release()
    }
    el.addEventListener('pointerdown', onDown, { capture: true })
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    if (import.meta.env.DEV) {
      const orbit = (at?: { x: number; z: number }): OrbitProbe => {
        const { camera, size } = get()
        const c = controls.current
        let px: { x: number; y: number } | null = null
        if (at) {
          const ndc = new Vector3(at.x, 0, at.z).project(camera)
          px = { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height }
        }
        return {
          azimuth: c ? c.getAzimuthalAngle() : 0,
          distance: c ? camera.position.distanceTo(c.target) : 0,
          target: c ? { x: c.target.x, z: c.target.z } : { x: 0, z: 0 },
          lock: t.lock,
          zoomSpeed: c ? c.zoomSpeed : 0,
          rotateSpeed: c ? c.rotateSpeed : 0,
          px,
        }
      }
      window.__underground = { ...window.__underground, orbit }
    }
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true })
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      release()
      touchReset(t)
      r.due = false
      if (import.meta.env.DEV && window.__underground) delete window.__underground.orbit
    }
  }, [gl, get, connected, controls])

  // Before drei's update() (-1). While the lock holds it re-applies the goal every frame (setAzimuthalAngle
  // replaces the pending damped turn with the rest of the way to it, so this paces the turn per frame), and once
  // more for a goal a last move left before the lift. No allocation.
  useFrame(() => {
    const r = run.current
    const c = controls.current
    if (!c || (r.t.lock !== 'rotate' && !r.due)) return
    r.due = false
    c.setAzimuthalAngle(r.goal)
  }, -2)

  return useRef<TouchOrbitHandle>({ isTouch: () => touch.current }).current
}
