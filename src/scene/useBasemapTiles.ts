/**
 * Runs the basemap tile store for the scene: started only after the first frame and an idle callback (so no tile
 * request comes before the first paint), fed the view each frame, disposed on unmount. Read-only toward the
 * camera: its frame runs at priority 0, after CameraRig, drei's update and the follow have moved it.
 *
 * Privacy hold: a location point flight frames the user's fix, so tiles requested for it would tell the host
 * where they are. From such a flight until the user's own gesture (the controls' `start`) or a station flight,
 * no new tile is requested; tiles already loaded still draw.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import type { BasemapConfig } from '../data/basemapConfig'
import { createBasemapTiles, type BasemapTiles } from '../data/basemapTiles'
import { newPose } from '../lib/basemap/reselect'
import { useFocus } from '../lib/focus'
import type { MapControlsImpl } from './cameraFlight'

/** The idle callback's deadline: tiles start loading by then even if the main thread never idles. */
const IDLE_TIMEOUT_MS = 2000

type Phase = 'waiting' | 'scheduled' | 'started'

export function useBasemapTiles(config: BasemapConfig): BasemapTiles {
  const store = useMemo(() => createBasemapTiles(config), [config])
  const controls = useThree((s) => s.controls) as MapControlsImpl | null
  const { flyRequest } = useFocus()
  const pose = useRef(newPose())
  const phase = useRef<Phase>('waiting')
  const cancelIdle = useRef<(() => void) | null>(null)

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
    if (flyRequest?.kind === 'point') store.hold(true)
    else if (flyRequest?.kind === 'station') store.hold(false)
  }, [flyRequest, store])

  // A listener, not a MapControls prop: a changed on* prop makes drei reconnect the controls (AGENTS.md).
  useEffect(() => {
    if (!controls) return
    const release = () => store.hold(false)
    controls.addEventListener('start', release)
    return () => controls.removeEventListener('start', release)
  }, [controls, store])

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
