import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import type { Network } from '../lib/network'
import { interiorOpacity, labelOpacity, veilWeight } from '../lib/interiorReveal'
import { depthFactor, depthScaleY } from '../lib/tilt'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { interiorLook } from './interiorLook'
import type { InteriorModel } from './interiorModel'
import { InteriorVeil } from './InteriorVeil'
import { RENDER_ORDER } from './renderOrder'
import { useLineLayer, type LineDash } from './useLineLayer'
import { useLevelLabels } from './useLevelLabels'

const DASH: LineDash = { size: theme.interiorApproxDash, gap: theme.interiorApproxGap }

interface StationInteriorProps {
  model: InteriorModel
  network: Network
}

/**
 * The focused station's interior as merged line layers in a group at its anchor: fine, then strong, for the platform
 * the lifted trains ride and below, and the same pair for the levels above, drawn after those trains. Plus the street
 * veil and DOM level labels. Everything fades in with the tilt; the levels' depth, the veil and the labels come in
 * with the depth factor (tilt.ts), so a flat view shows the interior as a plan.
 */
export function StationInterior({ model, network }: StationInteriorProps) {
  const station = network.stationById.get(model.stationId)
  if (!station) throw new Error(`Interior for unknown station "${model.stationId}"`)
  const group = useRef<Group>(null)
  const veil = useRef<Mesh>(null)
  const shown = useRef(-1)
  const shownDepth = useRef(-1)
  /** The labels' opacity as last written, for a label div mounted after it. */
  const labelShown = useRef(0)
  const { under } = interiorLook
  const dash = model.dashed ? DASH : undefined
  const strong = useLineLayer(
    model.strong,
    under ? RENDER_ORDER.interiorUnder : RENDER_ORDER.interior,
    theme.interiorLineWidth,
    dash,
  )
  const fine = useLineLayer(
    model.fine,
    under ? RENDER_ORDER.interiorUnderFine : RENDER_ORDER.interiorFine,
    theme.interiorFineWidth,
    dash,
  )
  // Levels above the lifted platform trains (SpanCars), drawn after them; look C leaves these empty.
  const overStrong = useLineLayer(model.overStrong, RENDER_ORDER.interiorOver, theme.interiorLineWidth, dash)
  const overFine = useLineLayer(model.overFine, RENDER_ORDER.interiorOverFine, theme.interiorFineWidth, dash)

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const distance = cameraDistance(state)
    const o = interiorOpacity(distance)
    // The levels separate with the tilt (y only: dashes are object-space, so x/z never rescale).
    const depth = depthFactor(distance)
    if (o === shown.current && depth === shownDepth.current) return
    shown.current = o
    shownDepth.current = depth
    g.visible = o > 0
    g.scale.y = depthScaleY(depth)
    if (strong) strong.material.opacity = o
    if (fine) fine.material.opacity = o
    if (overStrong) overStrong.material.opacity = o
    if (overFine) overFine.material.opacity = o
    if (veil.current) (veil.current.material as MeshBasicMaterial).opacity = interiorLook.veilOpacity * veilWeight(o, depth)
    labelShown.current = labelOpacity(o, depth)
  })

  useLevelLabels(model.labels, group, labelShown)

  return (
    <>
      <group ref={group} position={[model.origin.x, 0, model.origin.z]} visible={false}>
      {interiorLook.veil !== 'none' && <InteriorVeil ref={veil} hull={model.hull} />}
      {fine && <primitive object={fine} />}
      {strong && <primitive object={strong} />}
      {overFine && <primitive object={overFine} />}
      {overStrong && <primitive object={overStrong} />}
      </group>
    </>
  )
}
