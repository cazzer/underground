/**
 * Runs the basemap tile store for the scene: started only after the first frame and an idle callback (so no tile
 * request comes before the first paint), fed the view each frame, disposed on unmount. Read-only toward the
 * camera: its frame runs at priority 0, after CameraRig, drei's update and the follow have moved it.
 *
 * Location cap (useLocationCap.ts, mounted once in Scene whether or not the basemap is): while the shared cap is on,
 * the store asks for no tile finer than CAP_Z. This hook mirrors the handle onto `store.capZoom` in a layout effect
 * (the cap's current state first, then each change), so a cap set in the commit of a location flight is in force
 * before any frame of the flight, even a reduced-motion one that lands in its first frame.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import type { BasemapConfig } from '../data/basemapConfig'
import { createBasemapTiles } from '../data/basemapTiles'
import type { BasemapTiles } from '../data/basemapTypes'
import { CAP_Z } from '../lib/basemap/locationCap'
import type { LocationCap } from '../lib/basemap/locationCapHandle'
import { newPose } from '../lib/basemap/reselect'
import type { PackedTracks } from '../lib/routeTracks'
import type { MapControlsImpl } from './cameraFlight'

/** The idle callback's deadline: tiles start loading by then even if the main thread never idles. */
const IDLE_TIMEOUT_MS = 2000

type Phase = 'waiting' | 'scheduled' | 'started'

export function useBasemapTiles(config: BasemapConfig, tracks: PackedTracks, cap: LocationCap): BasemapTiles {
  const store = useMemo(() => createBasemapTiles(config, tracks), [config, tracks])
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

  useLayoutEffect(() => {
    if (cap.isCapped()) store.capZoom(CAP_Z)
    return cap.subscribe((capped) => store.capZoom(capped ? CAP_Z : null))
  }, [store, cap])

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
