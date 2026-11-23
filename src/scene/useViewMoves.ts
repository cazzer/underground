/**
 * The pointer events that mean "the user moved the view" (locationCap.ts's `CapEvent`: a press, its moves and end, a
 * wheel step, the window losing focus), from the element MapControls listens on. Shared by the basemap's location cap
 * and the place hold (placeHold.ts), which judge the same slop. The listeners are passive and never MapControls props
 * (a changed on* prop makes drei reconnect the controls, AGENTS.md); `onEvent` should be stable, or they re-attach.
 */
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { CapEvent } from '../lib/basemap/locationCap'

/** The element MapControls listens on (drei: `domElement || events.connected || gl.domElement`). */
export function useControlsElement(): HTMLElement {
  return useThree((s) => (s.events.connected as HTMLElement | undefined) || s.gl.domElement)
}

export function useViewMoves(el: HTMLElement, onEvent: (e: CapEvent) => void): void {
  useEffect(() => {
    const touch = (e: PointerEvent) => e.pointerType === 'touch'
    const onDown = (e: PointerEvent) => onEvent({ type: 'down', id: e.pointerId, x: e.clientX, y: e.clientY, touch: touch(e), primary: e.isPrimary })
    const onMove = (e: PointerEvent) => {
      // A mouse or pen with no button held is hovering, not dragging.
      if (e.pointerType !== 'touch' && e.buttons === 0) return
      onEvent({ type: 'move', id: e.pointerId, x: e.clientX, y: e.clientY })
    }
    const onBlur = () => onEvent({ type: 'blur' })
    const onUp = (e: PointerEvent) => onEvent({ type: 'up', id: e.pointerId })
    const onWheel = () => onEvent({ type: 'wheel' })
    el.addEventListener('pointerdown', onDown, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    // On the window: a mouse drag isn't captured to the canvas (MapControls listens on the document).
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [el, onEvent])
}
