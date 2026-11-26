import { useThree } from '@react-three/fiber'
import { useEffect, type RefObject } from 'react'
import { Vector3 } from 'three'
import type { AmenityMarkProbe } from '../lib/focus'
import { presenceOf, type AmenityFrame } from './amenityFrame'
import type { MarkSizes } from './amenitySizes'

/** What the marks last drew with: the reveal opacity and the sizes (StationAmenities' frame writes it). */
export interface AmenityView {
  opacity: number
  sizes: MarkSizes
}

/**
 * Dev-only test tooling: `__underground.amenityMarks()` gives every mark as last drawn: its station, kind, tier
 * (`under`, `over`, or `both` mid cross-fade), ground point, centre in viewport px, plate half size in px (along the
 * screen's x) and the reveal opacity.
 */
export function useAmenityProbe(frame: RefObject<AmenityFrame | null>, view: RefObject<AmenityView>): void {
  const get = useThree((s) => s.get)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const amenityMarks = (): AmenityMarkProbe[] => {
      const f = frame.current
      if (!f) return []
      const { camera, size } = get()
      const { opacity, sizes } = view.current
      const toPx = (x: number, z: number) => {
        const v = new Vector3(x, 0, z).project(camera)
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height }
      }
      return f.marks.map((m, i) => {
        const p = presenceOf(f, i)
        const px = toPx(f.x[i]!, f.z[i]!)
        const right = toPx(f.x[i]! + sizes.plate, f.z[i]!)
        return {
          stationId: m.stationId,
          kind: m.kind,
          tier: p >= 1 ? 'over' : p <= 0 ? 'under' : 'both',
          ground: { x: f.x[i]!, z: f.z[i]! },
          px,
          halfPx: Math.hypot(right.x - px.x, right.y - px.y),
          opacity,
        }
      })
    }
    window.__underground = { ...window.__underground, amenityMarks }
    return () => {
      if (window.__underground) delete window.__underground.amenityMarks
    }
  }, [get, frame, view])
}
