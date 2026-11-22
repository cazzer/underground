import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, type Group } from 'three'
import { useStationStreets, type StreetLayer } from '../data/useStationStreets'
import { entranceMarkBuffers, unmatchedEntrances } from '../lib/entranceMarks'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { interiorOpacity, veilWeight } from '../lib/interiorReveal'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Rgb } from '../lib/lineBuffers'
import { streetLabelOpacity } from '../lib/streetLabelReveal'
import { streetColorScale, veiledStreetHex } from '../lib/streetVeil'
import { depthFactor } from '../lib/tilt'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { interiorLook } from './interiorLook'
import { ENTRANCE_SIZE_M, type InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { streetsLook } from './streetsLook'
import { useLineLayer } from './useLineLayer'
import { useStreetLabels } from './useStreetLabels'

// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const linear = (hex: string): Rgb => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}
const MARK_RGB = linear(theme.interiorEntrance)
const STREET_RGB = linear(theme.streetStroke)
const VEILED_RGB = linear(veiledStreetHex(theme.streetStroke, theme.background))

interface StationStreetsProps {
  /** The focused station's interior, once loaded: its entrances get no second mark. */
  interior: InteriorModel | null
  /** The focused station has an interior still loading: no marks yet, so none flash before it lands. */
  interiorPending: boolean
  insets: Insets
  panel: ScreenRect | null
  /** The level labels' screen rects, which the street labels keep clear of. */
  labelBlockers: LabelBlockers
}

/**
 * The focused station's streets, interior or not: fetched on focus, drawn while it stays focused, gone with the
 * focus. Keyed by station, so a new station starts hidden and fades in from its own first frame.
 */
export function StationStreets({ interior, ...rest }: StationStreetsProps) {
  const { focusedId } = useFocus()
  const layer = useStationStreets(focusedId)
  if (!layer) return null
  const own = interior?.stationId === layer.stationId ? interior : null
  return <StreetLines key={layer.stationId} layer={layer} interior={own} {...rest} />
}

interface StreetLinesProps extends StationStreetsProps {
  layer: StreetLayer
}

/**
 * Whether the streets draw above the interior veil: with the station's interior loaded under look A (the screen
 * veil), so they rest faint behind the interior instead of vanishing under the veil; `?streets=` forces either.
 */
function overVeil(interior: InteriorModel | null): boolean {
  if (streetsLook !== 'auto') return streetsLook === 'over'
  return interior !== null && interiorLook.veil === 'screen'
}

/**
 * One merged line layer at street level (y = 0) at the station's anchor, and the marks of the entrances the interior
 * doesn't draw, fading in with the interior reveal; then the street and entrance labels. Above the veil the streets
 * dim toward the background as the veil rises (streetVeil.ts).
 */
function StreetLines({ layer, interior, interiorPending, insets, panel, labelBlockers }: StreetLinesProps) {
  const group = useRef<Group>(null)
  const shown = useRef(-1)
  const shownVeil = useRef(-1)
  const labelShown = useRef(0)
  const insetsRef = useRef(insets)
  const panelRef = useRef(panel)
  // Read per frame by the labels; synced after commit, before the next frame.
  useLayoutEffect(() => {
    insetsRef.current = insets
    panelRef.current = panel
  }, [insets, panel])
  const over = overVeil(interior)
  const lines = useLineLayer(layer.buffers, over ? RENDER_ORDER.streetsOver : RENDER_ORDER.streets, theme.streetWidth)
  const markBuffers = useMemo(() => {
    if (interiorPending) return null
    const at = interior && { origin: interior.origin, entrances: interior.entrances }
    return entranceMarkBuffers(layer.file, unmatchedEntrances(layer.file, layer.anchor, at), ENTRANCE_SIZE_M, MARK_RGB)
  }, [layer, interior, interiorPending])
  const marks = useLineLayer(markBuffers, RENDER_ORDER.streetEntrance, theme.interiorFineWidth)
  // A rebuilt layer (the draw order changes when the interior lands) starts at full opacity and color: catch it up.
  useLayoutEffect(() => {
    shown.current = -1
    shownVeil.current = -1
  }, [lines])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const distance = cameraDistance(state)
    const o = interiorOpacity(distance)
    const depth = depthFactor(distance)
    labelShown.current = streetLabelOpacity(o, depth)
    if (marks && marks.material.opacity !== o) marks.material.opacity = o
    // Only the auto rule dims: a forced `over` keeps full color, as before the auto rule.
    const veil = over && streetsLook === 'auto' ? veilWeight(o, depth) : 0
    if (lines && veil !== shownVeil.current) {
      streetColorScale(lines.material.color, STREET_RGB, VEILED_RGB, veil)
      shownVeil.current = veil
    }
    if (o === shown.current) return
    shown.current = o
    if (lines) lines.material.opacity = o
    g.visible = o > 0
  })

  useStreetLabels(layer, labelShown, insetsRef, panelRef, labelBlockers, ENTRANCE_SIZE_M / 2)

  return (
    <group ref={group} position={[layer.anchor.x, 0, layer.anchor.z]} visible={false}>
      {lines && <primitive object={lines} />}
      {marks && <primitive object={marks} />}
    </group>
  )
}
