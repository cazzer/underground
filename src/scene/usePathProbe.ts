import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import { priorityTiers, type PriorityFrame } from '../lib/pathFrame'
import type { StationPathProbe } from '../lib/focus'
import type { FramePoint } from '../lib/freeFrame'
import type { Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import { depthFactor } from '../lib/tilt'
import type { MapControlsImpl } from './cameraFlight'

/**
 * Dev-only test tooling: `__underground.stationPathAt()` gives the priority frame's points (the path's marker ends and
 * centerline, and the out-of-service machines' ends) in viewport px at the current depth factor, with the camera's
 * distance and the free rect, so a script can check the landing keeps them above the panel.
 */
export function usePathProbe(frame: PriorityFrame | null, insets: Insets, panel: ScreenRect | null): void {
  const get = useThree((s) => s.get)
  useEffect(() => {
    if (!import.meta.env.DEV || !frame) return
    const stationPathAt = (): StationPathProbe => {
      const { camera, size, controls } = get()
      const target = (controls as MapControlsImpl | null)?.target ?? new Vector3()
      const distance = camera.position.distanceTo(target)
      const depth = depthFactor(distance)
      const screen = (p: FramePoint) => {
        const ndc = new Vector3(p.x, p.y * depth, p.z).project(camera)
        return { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height }
      }
      const [path, outages] = priorityTiers(frame)
      return { interiorId: frame.interiorId, distance, path: path.map(screen), outages: outages.map(screen), free: interiorFreeRect(size, insets, panel) }
    }
    window.__underground = { ...window.__underground, stationPathAt }
    return () => {
      if (window.__underground) delete window.__underground.stationPathAt
    }
  }, [get, frame, insets, panel])
}
