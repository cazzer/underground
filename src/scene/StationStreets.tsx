import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, type Group } from 'three'
import { useStationStreets, type StreetLayer } from '../data/useStationStreets'
import { entranceMarkBuffers, unmatchedEntrances } from '../lib/entranceMarks'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { interiorOpacity } from '../lib/interiorReveal'
import type { Rgb } from '../lib/lineBuffers'
import { streetLabelOpacity } from '../lib/streetLabelReveal'
import { depthFactor } from '../lib/tilt'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import type { InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { streetsLook } from './streetsLook'
import { useLineLayer } from './useLineLayer'
import { useStreetLabels } from './useStreetLabels'

const ORDER = streetsLook === 'over' ? RENDER_ORDER.streetsOver : RENDER_ORDER.streets
/** An entrance mark's side, meters: the interior's own entrance squares' (interiorModel.ts). */
const ENTRANCE_MARK_M = 2.5
// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const MARK_COLOR = new Color(theme.interiorEntrance)
const MARK_RGB: Rgb = [MARK_COLOR.r, MARK_COLOR.g, MARK_COLOR.b]

interface StationStreetsProps {
  /** The focused station's interior, once loaded: its entrances get no second mark. */
  interior: InteriorModel | null
  /** The focused station has an interior still loading: no marks yet, so none flash before it lands. */
  interiorPending: boolean
  insets: Insets
  panel: ScreenRect | null
}

/**
 * The focused station's streets, interior or not: fetched on focus, drawn while it stays focused, gone with the
 * focus. Keyed by station, so a new station starts hidden and fades in from its own first frame.
 */
export function StationStreets({ interior, interiorPending, insets, panel }: StationStreetsProps) {
  const { focusedId } = useFocus()
  const layer = useStationStreets(focusedId)
  if (!layer) return null
  const own = interior?.stationId === layer.stationId ? interior : null
  return (
    <StreetLines key={layer.stationId} layer={layer} interior={own} interiorPending={interiorPending} insets={insets} panel={panel} />
  )
}

interface StreetLinesProps extends StationStreetsProps {
  layer: StreetLayer
}

/**
 * One merged line layer at street level (y = 0) at the station's anchor, and the marks of the entrances the interior
 * doesn't draw, fading in with the interior reveal; then the street and entrance labels.
 */
function StreetLines({ layer, interior, interiorPending, insets, panel }: StreetLinesProps) {
  const group = useRef<Group>(null)
  const shown = useRef(-1)
  const labelShown = useRef(0)
  const insetsRef = useRef(insets)
  const panelRef = useRef(panel)
  // Read per frame by the labels; synced after commit, before the next frame.
  useLayoutEffect(() => {
    insetsRef.current = insets
    panelRef.current = panel
  }, [insets, panel])
  const lines = useLineLayer(layer.buffers, ORDER, theme.streetWidth)
  const markBuffers = useMemo(() => {
    if (interiorPending) return null
    const at = interior && { origin: interior.origin, entrances: interior.entrances }
    return entranceMarkBuffers(layer.file, unmatchedEntrances(layer.file, layer.anchor, at), ENTRANCE_MARK_M, MARK_RGB)
  }, [layer, interior, interiorPending])
  const marks = useLineLayer(markBuffers, RENDER_ORDER.streetEntrance, theme.interiorFineWidth)

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const distance = cameraDistance(state)
    const o = interiorOpacity(distance)
    labelShown.current = streetLabelOpacity(o, depthFactor(distance))
    // A mark layer rebuilt since the last write starts at opacity 1: catch it up.
    if (marks && marks.material.opacity !== o) marks.material.opacity = o
    if (o === shown.current) return
    shown.current = o
    if (lines) lines.material.opacity = o
    g.visible = o > 0
  })

  useStreetLabels(layer, labelShown, insetsRef, panelRef, ENTRANCE_MARK_M / 2)

  return (
    <group ref={group} position={[layer.anchor.x, 0, layer.anchor.z]} visible={false}>
      {lines && <primitive object={lines} />}
      {marks && <primitive object={marks} />}
    </group>
  )
}
