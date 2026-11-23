import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { capStep, newCap, type CapEvent } from '../lib/basemap/locationCap'

/**
 * Calls `onMoved` when the visitor moves the view with the pointer: a drag past the click slop (6 px mouse, 10 px
 * touch), a second finger down or a wheel step. A tap that doesn't move, or the controls' `start` alone, is not one.
 * It runs locationCap.ts's rules unchanged, always armed (that state machine reports only the first move after it is
 * armed, so it is re-armed before each event); it reads the same elements the basemap's location cap does.
 */
export function useViewMoved(onMoved: () => void): void {
  // The element MapControls listens on (drei: `domElement || events.connected || gl.domElement`).
  const el = useThree((s) => (s.events.connected as HTMLElement | undefined) || s.gl.domElement)
  const callback = useRef(onMoved)
  useEffect(() => {
    callback.current = onMoved
  }, [onMoved])

  useEffect(() => {
    const cap = newCap()
    const step = (e: CapEvent) => {
      cap.capped = true
      if (capStep(cap, e)) callback.current()
    }
    const touch = (e: PointerEvent) => e.pointerType === 'touch'
    const onDown = (e: PointerEvent) => step({ type: 'down', id: e.pointerId, x: e.clientX, y: e.clientY, touch: touch(e), primary: e.isPrimary })
    const onMove = (e: PointerEvent) => {
      // A mouse or pen with no button held is hovering, not dragging.
      if (e.pointerType !== 'touch' && e.buttons === 0) return
      step({ type: 'move', id: e.pointerId, x: e.clientX, y: e.clientY })
    }
    const onUp = (e: PointerEvent) => step({ type: 'up', id: e.pointerId })
    const onWheel = () => step({ type: 'wheel' })
    const onBlur = () => step({ type: 'blur' })
    el.addEventListener('pointerdown', onDown, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    window.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [el])
}
