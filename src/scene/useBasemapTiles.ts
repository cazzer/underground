/**
 * Runs the basemap tile store for the scene: started only after the first frame and an idle callback (so no tile
 * request comes before the first paint), fed the view each frame, disposed on unmount. Read-only toward the
 * camera: its frame runs at priority 0, after CameraRig, drei's update and the follow have moved it.
 *
 * Location cap (locationCap.ts): a location point flight caps tile zoom at CAP_Z until the user moves the view
 * past the click slop, wheels, pinches or picks a station. The pointer listeners are passive and on the canvas and
 * window, never MapControls props (a changed on* prop makes drei reconnect the controls, AGENTS.md).
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import type { BasemapConfig } from '../data/basemapConfig'
import { createBasemapTiles } from '../data/basemapTiles'
import type { BasemapTiles } from '../data/basemapTypes'
import { CAP_Z, capStep, newCap, type CapEvent, type CapState } from '../lib/basemap/locationCap'
import { newPose } from '../lib/basemap/reselect'
import { useFocus } from '../lib/focus'
import type { MapControlsImpl } from './cameraFlight'

/** The idle callback's deadline: tiles start loading by then even if the main thread never idles. */
const IDLE_TIMEOUT_MS = 2000

type Phase = 'waiting' | 'scheduled' | 'started'

/** Feeds the cap machine one event and tells the store when the cap goes on or off. */
function stepCap(cap: CapState, store: BasemapTiles, e: CapEvent): void {
  const was = cap.capped
  const lifted = capStep(cap, e)
  if (!was && cap.capped) store.capZoom(CAP_Z)
  else if (lifted) store.capZoom(null)
}

export function useBasemapTiles(config: BasemapConfig): BasemapTiles {
  const store = useMemo(() => createBasemapTiles(config), [config])
  const el = useThree((s) => s.gl.domElement)
  const { flyRequest } = useFocus()
  const pose = useRef(newPose())
  const phase = useRef<Phase>('waiting')
  const cancelIdle = useRef<(() => void) | null>(null)
  const cap = useRef(newCap())

  useEffect(
    () => () => {
      cancelIdle.current?.()
      cancelIdle.current = null
      phase.current = 'waiting'
      store.dispose()
    },
    [store],
  )

  useEffect(() => {
    if (flyRequest?.kind === 'point') stepCap(cap.current, store, { type: 'pointFlight' })
    else if (flyRequest?.kind === 'station') stepCap(cap.current, store, { type: 'station' })
  }, [flyRequest, store])

  useEffect(() => {
    const touch = (e: PointerEvent) => e.pointerType === 'touch'
    const step = (e: CapEvent) => stepCap(cap.current, store, e)
    const onDown = (e: PointerEvent) => step({ type: 'down', id: e.pointerId, x: e.clientX, y: e.clientY, touch: touch(e), primary: e.isPrimary })
    const onMove = (e: PointerEvent) => step({ type: 'move', id: e.pointerId, x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => step({ type: 'up', id: e.pointerId })
    const onWheel = () => step({ type: 'wheel' })
    el.addEventListener('pointerdown', onDown, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    // On the window: a mouse drag isn't captured to the canvas (MapControls listens on the document).
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [el, store])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, basemap: () => store.stats() }
    return () => {
      if (window.__underground) delete window.__underground.basemap
    }
  }, [store])

  useFrame((state) => {
    if (phase.current === 'waiting') {
      phase.current = 'scheduled'
      const begin = () => {
        cancelIdle.current = null
        phase.current = 'started'
        store.start()
      }
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(begin, { timeout: IDLE_TIMEOUT_MS })
        cancelIdle.current = () => cancelIdleCallback(id)
      } else {
        const id = setTimeout(begin, 0)
        cancelIdle.current = () => clearTimeout(id)
      }
      return
    }
    if (phase.current !== 'started') return
    const c = state.controls as MapControlsImpl | null
    if (!c) return
    const p = pose.current
    p.tx = c.target.x
    p.tz = c.target.z
    p.distance = state.camera.position.distanceTo(c.target)
    p.azimuth = c.getAzimuthalAngle()
    p.width = state.size.width
    p.height = state.size.height
    store.update(p, state.camera as PerspectiveCamera, performance.now())
  }, 0)

  return store
}
