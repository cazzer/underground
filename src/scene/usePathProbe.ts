import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import type { PathFrame } from '../lib/pathFrame'
import type { StationPathProbe } from '../lib/focus'
import type { Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import { depthFactor } from '../lib/tilt'
import type { MapControlsImpl } from './cameraFlight'

/**
 * Dev-only test tooling: `__underground.stationPathAt()` gives the framed station path's points (marker ends and
 * centerline) in viewport px at the current depth factor, with the camera's distance and the free rect, so a script
 * can check the landing keeps the path above the trip panel.
 */
export function usePathProbe(path: PathFrame | null, insets: Insets, panel: ScreenRect | null): void {
  const get = useThree((s) => s.get)
  useEffect(() => {
    if (!import.meta.env.DEV || !path) return
    const stationPathAt = (): StationPathProbe => {
      const { camera, size, controls } = get()
      const target = (controls as MapControlsImpl | null)?.target ?? new Vector3()
      const distance = camera.position.distanceTo(target)
      const depth = depthFactor(distance)
      const points = path.wanted.slice(0, path.pathCount).map((p) => {
        const ndc = new Vector3(p.x, p.y * depth, p.z).project(camera)
        return { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height }
      })
      return { interiorId: path.interiorId, distance, path: points, free: interiorFreeRect(size, insets, panel) }
    }
    window.__underground = { ...window.__underground, stationPathAt }
    return () => {
      if (window.__underground) delete window.__underground.stationPathAt
    }
  }, [get, path, insets, panel])
}
