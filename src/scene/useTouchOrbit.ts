import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { Vector3 } from 'three'
import type { OrbitProbe } from '../lib/focus'
import { clampAzimuth, createTouchOrbit, takeTurn, touchDown, touchMove, touchUp } from '../lib/touchOrbit'
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

/**
 * Two-finger twist to orbit (lib/touchOrbit.ts). The controls still zoom a two-finger touch but never turn it
 * (useStationOrbit holds their rotateSpeed at 0 for touch); this follows the two live touches on the element the
 * controls listen on and, once a gesture locks to rotate, holds the controls' zoom (zoomSpeed 0, restored when it
 * ends) and steers the azimuth through setAzimuthalAngle, whose damping keeps the controls' lag and glide. The goal
 * is unwrapped and clamped to the controls' window. No props or on* handlers of the controls change (underground-by0).
 * Its pointerdown listens in the capture phase, before the controls' own, so onGestureStart knows the pointer type;
 * its pointermove is on the element, before the controls' document listener, so a lock lands before that move's dolly.
 */
export function useTouchOrbit({ controls, canTurn }: TouchOrbitOptions): TouchOrbitHandle {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const connected = useThree((s) => s.events.connected as HTMLElement | undefined)
  const touch = useRef(false)
  const canTurnRef = useRef(canTurn)
  useLayoutEffect(() => {
    canTurnRef.current = canTurn
  }, [canTurn])

  useEffect(() => {
    const el = connected ?? gl.domElement
    const t = createTouchOrbit()
    let goal = 0
    let held: MapControlsImpl | null = null
    let heldZoom = 1
    const release = () => {
      if (held) held.zoomSpeed = heldZoom
      held = null
    }
    const onDown = (e: PointerEvent) => {
      touch.current = e.pointerType === 'touch'
      if (!touch.current) return
      touchDown(t, e.pointerId, e.clientX, e.clientY)
      release()
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const c = controls.current
      if (!c) return
      const was = t.lock
      touchMove(t, e.pointerId, e.clientX, e.clientY, canTurnRef.current())
      if (t.lock !== 'rotate') return
      if (was !== 'rotate') {
        held = c
        heldZoom = c.zoomSpeed
        c.zoomSpeed = 0
        goal = c.getAzimuthalAngle()
      }
      const turn = takeTurn(t, el.clientHeight)
      if (turn === 0) return
      goal = clampAzimuth(goal + turn, c.minAzimuthAngle, c.maxAzimuthAngle)
      c.setAzimuthalAngle(goal)
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touchUp(t, e.pointerId)
      release()
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
      if (import.meta.env.DEV && window.__underground) delete window.__underground.orbit
    }
  }, [gl, get, connected, controls])

  return useRef<TouchOrbitHandle>({ isTouch: () => touch.current }).current
}
