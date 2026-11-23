import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh, MeshBasicMaterial } from 'three'
import { interiorOpacity, veilWeight } from '../lib/interiorReveal'
import { depthFactor } from '../lib/tilt'
import { cameraDistance, getControls } from './cameraDistance'
import { interiorLook } from './interiorLook'
import type { PresenceStore } from './InteriorPresence'
import { InteriorVeil } from './InteriorVeil'

interface ScreenVeilProps {
  /** The veil's share (PresenceDriver's veilShare: its own eased presence, on while the veil rule holds, x the highest interior presence). */
  store: PresenceStore
}

/**
 * Look A's one screen-wide veil, always mounted by Scene under look A (o3r.4). The reveal depends only on the camera
 * distance, so every drawn interior would set the same opacity: one plane dims the street once instead of one per
 * interior stacking, scaled by `store.veilShare` so it eases in and out with the interiors and the veil rule (none
 * with a bare station focused). It follows the orbit target (the camera's x/z without controls), so it covers the view
 * wherever the interiors are; opacity is written only when it changes.
 */
export function ScreenVeil({ store }: ScreenVeilProps) {
  const veil = useRef<Mesh>(null)
  const shown = useRef(-1)
  useFrame((state) => {
    const mesh = veil.current
    if (!mesh) return
    const distance = cameraDistance(state)
    const w = interiorLook.veilOpacity * veilWeight(interiorOpacity(distance), depthFactor(distance)) * store.veilShare
    const at = getControls(state)?.target ?? state.camera.position
    mesh.position.set(at.x, 0, at.z)
    if (w === shown.current) return
    shown.current = w
    ;(mesh.material as MeshBasicMaterial).opacity = w
    mesh.visible = w > 0
  })
  return <InteriorVeil ref={veil} hull={null} />
}
