import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, type Group } from 'three'
import type { StreetLayer } from '../data/useStationStreets'
import { claimMaskSlot, releaseMaskSlot, writeMaskSlot, type StreetMask } from '../lib/basemap/streetMask'
import { clipLineBuffers } from '../lib/clipLineBuffers'
import { entranceMarkBuffers, unmatchedEntrances } from '../lib/entranceMarks'
import { interiorOpacity } from '../lib/interiorReveal'
import type { Rgb } from '../lib/lineBuffers'
import type { Network } from '../lib/network'
import { buildRouteClip, CLIP_TRACK_REACH_M } from '../lib/routeClip'
import { localTracks } from '../lib/routeTracks'
import { clipToCell, type StreetCell } from '../lib/streetCells'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { theme } from '../theme'
import { writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { ENTRANCE_SIZE_M, type InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { streetsLook } from './streetsLook'
import { useLineLayer } from './useLineLayer'

// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const MARK_COLOR = new Color(theme.interiorEntrance)
const MARK_RGB: Rgb = [MARK_COLOR.r, MARK_COLOR.g, MARK_COLOR.b]

export interface StreetLinesProps {
  layer: StreetLayer
  /** The drawn interior covering this station, once loaded: its entrances get no second mark. */
  interior: InteriorModel | null
  /** Its interior is still loading: no marks yet, so none flash before it lands. */
  interiorPending: boolean
  /** Leave out the street pieces under a route line (routeClip.ts): only at a station with no interior. */
  clipped: boolean
  /** The part of the layer it draws where other drawn layers overlap it (streetCells.ts); NO_CELL for all of it. */
  cell: StreetCell
  /** Look A's screen veil is up (any interior drawn): the streets rest above it, faint. */
  veiled: boolean
  network: Network
  /** A slot is claimed while the layer is drawn, so the basemap's roads give way inside its radius (Basemap.tsx). */
  mask: StreetMask
  /** The trip emphasis (SubwayLines, -0.25): the street lines dim with the route lines by its `networkDim`. */
  tripLevels: EmphasisLevels
}

/**
 * How the streets draw: above the interior veil at the veiled stroke (about 1.9:1, streetVeil.ts) while look A's
 * screen veil is up (any interior drawn), so they rest faint behind it instead of vanishing under it; otherwise under
 * the route lines at full color. `?streets=` forces either order, at full color.
 */
function streetMode(veiled: boolean): 'under' | 'over' | 'veiled' {
  if (streetsLook !== 'auto') return streetsLook
  return veiled ? 'veiled' : 'under'
}

/**
 * One station's streets: one merged line layer at street level (y = 0) at its anchor, cut to its cell, and the marks
 * of the entrances its interior doesn't draw, fading in with the interior reveal. Keyed by station, so a new one
 * starts hidden and fades in from its own first frame.
 */
export function StreetLines({ layer, interior, interiorPending, clipped, cell, veiled, network, mask, tripLevels }: StreetLinesProps) {
  const group = useRef<Group>(null)
  const shown = useRef(-1)
  // The street pieces that run under a route line are left out, so none reads as one more track in its bundle. Not
  // at a station with an interior (loaded or loading): there the tracks sink under it, clear of the streets.
  // While the station index is still loading, every station counts as pending (focusedMarkerShown), so a station
  // with none draws its streets whole for that moment and the pieces under its lines pop out once the index lands.
  const clip = useMemo(
    () => (clipped ? buildRouteClip(localTracks(network.shapes, layer.anchor, layer.file.radiusM + CLIP_TRACK_REACH_M)) : null),
    [clipped, network, layer],
  )
  const mode = streetMode(veiled)
  const routeClipped = useMemo(() => {
    const base = mode === 'veiled' ? layer.veiledBuffers : layer.buffers
    return clip ? clipLineBuffers(base, clip) : base
  }, [mode, layer, clip])
  // The key names the overlapping layers, which fix the planes: an unchanged key keeps the buffers.
  const buffers = useMemo(() => clipToCell(routeClipped, cell), [routeClipped, cell.key])
  const lines = useLineLayer(
    buffers,
    mode === 'under' ? RENDER_ORDER.streets : RENDER_ORDER.streetsOver,
    theme.streetWidth,
    undefined,
    { dimmable: true },
  )
  const markBuffers = useMemo(() => {
    if (interiorPending) return null
    const at = interior && { origin: interior.origin, entrances: interior.entrances }
    return entranceMarkBuffers(layer.file, unmatchedEntrances(layer.file, layer.anchor, at), ENTRANCE_SIZE_M, MARK_RGB)
  }, [layer, interior, interiorPending])
  const marks = useLineLayer(markBuffers, RENDER_ORDER.streetEntrance, theme.interiorFineWidth)
  useLayoutEffect(() => {
    // A full mask has logged; this layer then draws over the roads it would mask.
    const slot = claimMaskSlot(mask)
    if (slot === null) return
    writeMaskSlot(mask, slot, layer.anchor.x, layer.anchor.z, layer.file.radiusM)
    return () => releaseMaskSlot(mask, slot)
  }, [layer, mask])
  // A rebuilt layer (the mode changes when an interior lands, the cell when a neighbour joins) starts at full opacity: catch it up.
  useLayoutEffect(() => {
    shown.current = -1
  }, [lines])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const o = interiorOpacity(cameraDistance(state))
    if (marks && marks.material.opacity !== o) marks.material.opacity = o
    if (lines) writeLineDim(lines.material, tripLevels.networkDim)
    if (o === shown.current) return
    shown.current = o
    if (lines) lines.material.opacity = o
    g.visible = o > 0
  })

  return (
    <group ref={group} position={[layer.anchor.x, 0, layer.anchor.z]} visible={false}>
      {lines && <primitive object={lines} />}
      {marks && <primitive object={marks} />}
    </group>
  )
}
