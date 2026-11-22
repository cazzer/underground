import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import type { StreetLayer } from '../data/useStationStreets'
import type { EntranceProbe } from '../lib/focus'
import type { Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { Ground } from '../lib/projection'
import type { MapControlsImpl } from './cameraFlight'

/**
 * Dev-only test tooling: `__underground.entrancesAt()` gives the focused station's entrance marks and its point in
 * viewport px, with the camera's distance and target and the free rect, so a script can check the landing frames them.
 */
export function useEntranceProbe(layer: StreetLayer, station: Ground | null, insets: Insets, panel: ScreenRect | null): void {
  const get = useThree((s) => s.get)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const toPx = (x: number, z: number) => {
      const { camera, size } = get()
      const ndc = new Vector3(x, 0, z).project(camera)
      return { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height }
    }
    const entrancesAt = (): EntranceProbe => {
      const { camera, size, controls } = get()
      const target = (controls as MapControlsImpl | null)?.target ?? new Vector3()
      return {
        stationId: layer.stationId,
        distance: camera.position.distanceTo(target),
        target: { x: target.x, z: target.z },
        station: station && { ground: station, px: toPx(station.x, station.z) },
        marks: layer.marks.map((m) => toPx(layer.anchor.x + m.x, layer.anchor.z + m.z)),
        free: interiorFreeRect(size, insets, panel),
        viewport: { width: size.width, height: size.height },
      }
    }
    window.__underground = { ...window.__underground, entrancesAt }
    return () => {
      if (window.__underground) delete window.__underground.entrancesAt
    }
  }, [get, layer, station, insets, panel])
}
