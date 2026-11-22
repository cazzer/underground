import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { Vector3 } from 'three'
import type { OrbitProbe } from '../lib/focus'
import { clampAzimuth, createTouchOrbit, takeTurn, touchDown, touchMove, touchReset, touchUp, wrapAngle, type TouchOrbit } from '../lib/touchOrbit'
import type { MapControlsImpl } from './cameraFlight'

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
}

/**
 * Two-finger twist to orbit (lib/touchOrbit.ts). The controls still zoom a two-finger touch but never turn it
 * (useStationOrbit holds their rotateSpeed at 0 for touch); this follows the two live touches on the element the
 * controls listen on and, once a gesture locks to rotate, steers the azimuth while the controls' pinch keeps
 * zooming (pah.6.1: a twist and a pinch in one gesture do both). Moves only move the goal; a frame at -2,
 * before drei's update(), applies it through setAzimuthalAngle, once per frame however many moves came in, whose
 * damping keeps the controls' lag and glide. No props or on* handlers of the controls change (underground-by0).
 * Its pointerdown listens in the capture phase, before the controls' own, so onGestureStart knows the pointer type;
 * its pointermove is on the element, before the controls' document listener, so a lock lands before that move's dolly.
 */
export function useTouchOrbit({ controls, canTurn }: TouchOrbitOptions): TouchOrbitHandle {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const connected = useThree((s) => s.events.connected as HTMLElement | undefined)
  const touch = useRef(false)
  const run = useRef<TwistRun>({ t: createTouchOrbit(), goal: 0, due: false })
  const canTurnRef = useRef(canTurn)
  useLayoutEffect(() => {
    canTurnRef.current = canTurn
  }, [canTurn])

  useEffect(() => {
    const el = connected ?? gl.domElement
    const r = run.current
    const t = r.t
    touchReset(t)
    const onDown = (e: PointerEvent) => {
      touch.current = e.pointerType === 'touch'
      if (!touch.current) {
        // A mouse or pen after a lost touch lift: forget the fingers.
        touchReset(t)
        return
      }
      if (e.isPrimary) touchReset(t)
      touchDown(t, e.pointerId, e.clientX, e.clientY)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const c = controls.current
      if (!c) return
      const was = t.lock
      touchMove(t, e.pointerId, e.clientX, e.clientY, canTurnRef.current())
      if (t.lock !== 'rotate') return
      if (was !== 'rotate') r.goal = c.getAzimuthalAngle()
      const turn = takeTurn(t, el.clientHeight)
      if (turn === 0) return
      // Unwrapped around the last goal, not the view: the view trails the goal (damping) and may be over π behind.
      r.goal = clampAzimuth(r.goal + turn, wrapAngle(r.goal), c.minAzimuthAngle, c.maxAzimuthAngle)
      r.due = true
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touchUp(t, e.pointerId)
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
      touchReset(t)
      r.due = false
      if (import.meta.env.DEV && window.__underground) delete window.__underground.orbit
    }
  }, [gl, get, connected, controls])

  // At -2, before drei's update() (-1). setAzimuthalAngle runs a controls update() itself, so a frame with a move
  // updates the controls twice (as the controls' own touch rotate did per move). Only on a frame where a move changed the goal: the moves since the last frame
  // collapse into one apply (setAzimuthalAngle replaces the pending damped turn with the rest of the way to the
  // goal), and the lift's last goal still applies once. Fingers held still apply nothing, so they never pull the
  // view back against a fly-to. No allocation.
  useFrame(() => {
    const r = run.current
    const c = controls.current
    if (!c || !r.due) return
    r.due = false
    c.setAzimuthalAngle(r.goal)
  }, -2)

  return useRef<TouchOrbitHandle>({ isTouch: () => touch.current }).current
}
