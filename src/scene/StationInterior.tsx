import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { interiorStationIds } from '../data/interiorLoad'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Network } from '../lib/network'
import { interiorOpacity, labelOpacity, veilWeight } from '../lib/interiorReveal'
import { depthFactor, depthScaleY } from '../lib/tilt'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { interiorLook } from './interiorLook'
import { interiorLayers, type InteriorModel } from './interiorModel'
import { InteriorVeil } from './InteriorVeil'
import { RENDER_ORDER, strokeOrders } from './renderOrder'
import { useLineLayer, type LineDash } from './useLineLayer'
import { useLevelLabels } from './useLevelLabels'

const DASH: LineDash = { size: theme.interiorApproxDash, gap: theme.interiorApproxGap }

interface StationInteriorProps {
  model: InteriorModel
  network: Network
  /** Ids of the elevators and escalators out of service, sorted: only a change redraws the layers. */
  outOfService: readonly string[]
  /** Where the level labels write their screen rects, for the street labels to keep clear of. */
  labelBlockers: LabelBlockers
  /** Drawn inside the interior's group (its anchor, depth factor and visibility): the trip's exit path. */
  children?: ReactNode
}

/**
 * The focused station's interior as merged line layers in a group at its anchor: fine, then strong, for each stroke
 * band (interiorDecks.ts): the deepest deck and below, the bands between decks (Union Sq has one), and the levels above
 * the shallowest deck, each band drawn after the lifted trains of the deck below it. Plus the street
 * veil and DOM level labels. Everything fades in with the tilt; the levels' depth, the veil and the labels come in
 * with the depth factor (tilt.ts), so a flat view shows the interior as a plan.
 */
export function StationInterior({ model, network, outOfService, labelBlockers, children }: StationInteriorProps) {
  // Every station the interior covers must be on the map: its spans, markers and camera all look them up.
  for (const id of interiorStationIds(model)) {
    if (!network.stationById.has(id)) throw new Error(`Interior ${model.stationId} covers unknown station "${id}"`)
  }
  const group = useRef<Group>(null)
  const veil = useRef<Mesh>(null)
  const shown = useRef(-1)
  const shownDepth = useRef(-1)
  /** The layers whose materials the last frame wrote: a rebuilt layer has fresh materials to bring to the opacity. */
  const shownLayers = useRef<typeof layers | null>(null)
  /** The labels' opacity as last written, for a label div mounted after it. */
  const labelShown = useRef(0)
  const { under } = interiorLook
  const dash = model.dashed ? DASH : undefined
  const outKey = outOfService.join(',')
  const layers = useMemo(() => interiorLayers(model, outKey), [model, outKey])
  const strong = useLineLayer(
    layers.strong,
    under ? RENDER_ORDER.interiorUnder : RENDER_ORDER.interior,
    theme.interiorLineWidth,
    dash,
  )
  const fine = useLineLayer(
    layers.fine,
    under ? RENDER_ORDER.interiorUnderFine : RENDER_ORDER.interiorFine,
    theme.interiorFineWidth,
    dash,
  )
  // Bands between decks, after the lower deck's lifted trains (SpanCars): two fixed pairs, so the hook count never
  // changes; a station with fewer decks leaves them null.
  const bandCount = layers.mid.length + 2
  const mid0 = layers.mid[0]
  const mid1 = layers.mid[1]
  const mid0Strong = useLineLayer(mid0?.strong ?? null, mid0 ? strokeOrders(1, bandCount).strong : 0, theme.interiorLineWidth, dash)
  const mid0Fine = useLineLayer(mid0?.fine ?? null, mid0 ? strokeOrders(1, bandCount).fine : 0, theme.interiorFineWidth, dash)
  const mid1Strong = useLineLayer(mid1?.strong ?? null, mid1 ? strokeOrders(2, bandCount).strong : 0, theme.interiorLineWidth, dash)
  const mid1Fine = useLineLayer(mid1?.fine ?? null, mid1 ? strokeOrders(2, bandCount).fine : 0, theme.interiorFineWidth, dash)
  if (layers.mid.length > 2) throw new Error(`Interior ${model.stationId} has ${layers.mid.length} bands between decks; at most 2 draw`)
  // Levels above the shallowest deck's lifted trains, drawn after them; look C leaves these empty.
  const overStrong = useLineLayer(layers.overStrong, RENDER_ORDER.interiorOver, theme.interiorLineWidth, dash)
  const overFine = useLineLayer(layers.overFine, RENDER_ORDER.interiorOverFine, theme.interiorFineWidth, dash)

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const distance = cameraDistance(state)
    const o = interiorOpacity(distance)
    // The levels separate with the tilt (y only: dashes are object-space, so x/z never rescale).
    const depth = depthFactor(distance)
    if (o === shown.current && depth === shownDepth.current && layers === shownLayers.current) return
    shown.current = o
    shownDepth.current = depth
    shownLayers.current = layers
    g.visible = o > 0
    g.scale.y = depthScaleY(depth)
    if (strong) strong.material.opacity = o
    if (fine) fine.material.opacity = o
    if (mid0Strong) mid0Strong.material.opacity = o
    if (mid0Fine) mid0Fine.material.opacity = o
    if (mid1Strong) mid1Strong.material.opacity = o
    if (mid1Fine) mid1Fine.material.opacity = o
    if (overStrong) overStrong.material.opacity = o
    if (overFine) overFine.material.opacity = o
    if (veil.current) (veil.current.material as MeshBasicMaterial).opacity = interiorLook.veilOpacity * veilWeight(o, depth)
    labelShown.current = labelOpacity(o, depth)
  })

  useLevelLabels(model.labels, group, labelShown, labelBlockers)

  return (
    <>
      <group ref={group} position={[model.origin.x, 0, model.origin.z]} visible={false}>
      {interiorLook.veil !== 'none' && <InteriorVeil ref={veil} hull={model.hull} />}
      {fine && <primitive object={fine} />}
      {strong && <primitive object={strong} />}
      {mid0Fine && <primitive object={mid0Fine} />}
      {mid0Strong && <primitive object={mid0Strong} />}
      {mid1Fine && <primitive object={mid1Fine} />}
      {mid1Strong && <primitive object={mid1Strong} />}
      {overFine && <primitive object={overFine} />}
      {overStrong && <primitive object={overStrong} />}
      {children}
      </group>
    </>
  )
}
