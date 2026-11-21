import type { MapControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, type ComponentRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { azimuthBounds, clampToRadius, ORBIT_RADIUS, type AzimuthBounds } from '../lib/orbitLimits'
import type { Ground } from '../lib/projection'
import { orbitLook } from './orbitLook'

type MapControlsImpl = ComponentRef<typeof MapControls>

interface StationOrbitOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  /** The focused station's ground position, or null when nothing is focused. */
  focusPos: Ground | null
  /** True while a fly-to or an interrupted-flight focus hold owns the camera. */
  busy: () => boolean
}

/**
 * Station orbit limits. Both frames write the controls imperatively: passing these as props or
 * on* handlers would re-run drei's connect effect and could lock the controls (underground-by0).
 */
export function useStationOrbit({ controls, camera, focusPos, busy }: StationOrbitOptions): void {
  const bounds = useRef<AzimuthBounds>({ min: 0, max: 0, rotate: false })
  const clamped = useRef<Ground>({ x: 0, z: 0 })
  const armed = useRef(false)
  const armedFor = useRef<Ground | null>(null)

  // Before drei's controls.update() (priority -1), beside the polar lock in CameraRig.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    azimuthBounds(
      {
        theta: c.getAzimuthalAngle(),
        focused: focusPos !== null,
        distance: camera.position.distanceTo(c.target),
        limit: orbitLook.limit,
        dt: delta,
      },
      bounds.current,
    )
    c.enableRotate = bounds.current.rotate
    c.minAzimuthAngle = bounds.current.min
    c.maxAzimuthAngle = bounds.current.max
  }, -2)

  // After update(), before render. Never above 0: a positive priority takes over rendering.
  useFrame(() => {
    const c = controls.current
    if (!c) return
    if (!focusPos || busy()) {
      armed.current = false
      return
    }
    if (armedFor.current !== focusPos) {
      armedFor.current = focusPos
      armed.current = false
    }
    // Armed only once the view is inside the radius, so a released focus hold never jumps.
    if (!armed.current) {
      armed.current = Math.hypot(c.target.x - focusPos.x, c.target.z - focusPos.z) <= ORBIT_RADIUS
      return
    }
    const out = clamped.current
    if (!clampToRadius(c.target, focusPos, ORBIT_RADIUS, out)) return
    camera.position.x += out.x - c.target.x
    camera.position.z += out.z - c.target.z
    c.target.x = out.x
    c.target.z = out.z
  }, -0.5)
}
