import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import type { Network } from '../lib/network'
import { interiorOpacity } from '../lib/interiorReveal'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { interiorLook } from './interiorLook'
import type { InteriorModel } from './interiorModel'
import { InteriorVeil } from './InteriorVeil'
import { RENDER_ORDER } from './renderOrder'
import { useLineLayer } from './useLineLayer'

function showLabel(el: HTMLDivElement, opacity: number): void {
  el.style.opacity = String(opacity)
  el.style.visibility = opacity > 0 ? 'visible' : 'hidden'
}

interface StationInteriorProps {
  model: InteriorModel
  network: Network
  /** Called when the interior starts or stops showing (camera inside or past the reveal distance). */
  onRevealed: (revealed: boolean) => void
}

/**
 * The focused station's interior as two merged line layers (fine, then strong) in a group at
 * its anchor, plus the street veil and DOM level labels. Everything fades in with the tilt.
 */
export function StationInterior({ model, network, onRevealed }: StationInteriorProps) {
  const station = network.stationById.get(model.stationId)
  if (!station) throw new Error(`Interior for unknown station "${model.stationId}"`)
  const group = useRef<Group>(null)
  const veil = useRef<Mesh>(null)
  const labels = useRef<(HTMLDivElement | null)[]>([])
  const shown = useRef(-1)
  const revealed = useRef<boolean | null>(null)
  // Unmounting (focus moved on, or the load was replaced) hides the interior.
  useEffect(() => () => onRevealed(false), [onRevealed])
  const { under } = interiorLook
  const strong = useLineLayer(model.strong, under ? RENDER_ORDER.interiorUnder : RENDER_ORDER.interior, theme.interiorLineWidth)
  const fine = useLineLayer(
    model.fine,
    under ? RENDER_ORDER.interiorUnderFine : RENDER_ORDER.interiorFine,
    theme.interiorFineWidth,
  )

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const o = interiorOpacity(cameraDistance(state))
    if (o === shown.current) return
    shown.current = o
    if (revealed.current !== o > 0) {
      revealed.current = o > 0
      onRevealed(o > 0)
    }
    g.visible = o > 0
    if (strong) strong.material.opacity = o
    if (fine) fine.material.opacity = o
    if (veil.current) (veil.current.material as MeshBasicMaterial).opacity = interiorLook.veilOpacity * o
    for (const el of labels.current) if (el) showLabel(el, o)
  })

  return (
    <>
      <group ref={group} position={[model.origin.x, 0, model.origin.z]} visible={false}>
      {interiorLook.veil !== 'none' && <InteriorVeil ref={veil} hull={model.hull} />}
      {fine && <primitive object={fine} />}
      {strong && <primitive object={strong} />}
      {model.labels.map((label, i) => (
        // zIndexRange [0, 0]: drei's default z-index would paint labels over the HUD panel.
        <Html key={label.levelId} position={label.position} zIndexRange={[0, 0]}>
          <div
            ref={(el) => {
              labels.current[i] = el
              // drei mounts Html content in its own root, often after the first frames have set
              // the opacity; a still camera would never update it again.
              if (el) showLabel(el, Math.max(shown.current, 0))
            }}
            style={{ opacity: 0, visibility: 'hidden' }}
            // pointer-events-none on the div itself: drei's pointerEvents prop only applies in
            // transform mode, and label events would bubble into r3f with the wrong offsets.
            className="pointer-events-none -translate-x-1/2 bg-canvas/80 px-1 font-mono text-[10px] whitespace-nowrap text-ink-dim uppercase tracking-widest"
          >
            {label.text}
          </div>
        </Html>
      ))}
      </group>
    </>
  )
}
