import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, type Group } from 'three'
import type { StreetLayer } from '../data/useStationStreets'
import { claimMaskSlot, releaseMaskSlot, writeMaskSlot, writeMaskStrength, type StreetMask } from '../lib/basemap/streetMask'
import { clipLineBuffers } from '../lib/clipLineBuffers'
import { entranceMarkBuffers, unmatchedEntrances } from '../lib/entranceMarks'
import { interiorOpacity } from '../lib/interiorReveal'
import type { LineBuffers, Rgb } from '../lib/lineBuffers'
import type { Network } from '../lib/network'
import { stepPresence, type Presence } from '../lib/presence'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { buildRouteClip, CLIP_TRACK_REACH_M, type RouteClip } from '../lib/routeClip'
import { mixHex } from '../lib/routeColor'
import { localTracks } from '../lib/routeTracks'
import { clipToCell, type StreetCell } from '../lib/streetCells'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { theme } from '../theme'
import { writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import type { PresenceStore } from './InteriorPresence'
import { ENTRANCE_SIZE_M, type InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { streetsLook } from './streetsLook'
import { useLineLayer } from './useLineLayer'

// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const rgbOf = (hex: string): Rgb => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}
const MARK_RGB = rgbOf(theme.interiorEntrance)
/** A neighbour's marks (a station in view, not the focused one): a dimmer tier (themeStreets.test.ts). */
const NEIGHBOUR_MARK_RGB = rgbOf(mixHex(theme.interiorEntrance, theme.background, theme.interiorEntranceNeighbourMix))
/** The interior's presence past which its own entrances stand in for the street marks. */
const INTERIOR_MARKS_AT = 0.5

export interface StreetLinesProps {
  layer: StreetLayer
  /** The focused station's layer: full-colour marks. Others get the neighbour tier. */
  focused: boolean
  /** This layer's presence: it eases in on joining and out on leaving (StationStreets steps the targets). */
  presence: Presence
  /** Called once when a leaving layer's presence reaches 0, so it can unmount. */
  onFaded: (stationId: string) => void
  /** Called once when a joining layer's presence reaches 1, so the cells take it in. */
  onSettled: () => void
  /** The shown interior covering this station, once loaded, and its presence: past one half its entrances get no
   *  second mark. */
  interior: InteriorModel | null
  interiorPresence: Presence | null
  /** Its interior is still loading: no marks yet, so none flash before it lands. */
  interiorPending: boolean
  /** Leave out the street pieces under a route line (routeClip.ts): only at a station with no interior. */
  clipped: boolean
  /** The part of the layer it draws where other drawn layers overlap it (streetCells.ts); NO_CELL for all of it. */
  cell: StreetCell
  /** The interiors' presences, whose `veilShare` (look A's screen veil) decides the stroke. */
  veil: PresenceStore
  network: Network
  /** A slot is claimed while the layer is mounted, so the basemap's roads give way inside its radius (Basemap.tsx). */
  mask: StreetMask
  /** The trip emphasis (SubwayLines, -0.25): the street lines dim with the route lines by its `networkDim`. */
  tripLevels: EmphasisLevels
}

const routeCut = (base: LineBuffers, clip: RouteClip | null): LineBuffers => (clip ? clipLineBuffers(base, clip) : base)

/**
 * One station's streets: a line layer at street level (y = 0) at its anchor, cut to its cell, and the marks of the
 * entrances its interior doesn't draw, fading in with the interior reveal times the layer's presence. Under look A
 * (`?streets=` auto) both strokes are built once: the full-colour one under the route lines and the veiled one above
 * the veil (about 1.9:1, streetVeil.ts), cross-faded by the veil's drawn share (the full one at 1 - share, the veiled
 * one at share; both drawn only between), so a veil easing in or out never re-cuts them.
 */
export function StreetLines(props: StreetLinesProps) {
  const { layer, focused, presence, onFaded, onSettled, interior, interiorPresence, interiorPending, clipped, cell, veil, network, mask, tripLevels } = props
  const group = useRef<Group>(null)
  const shown = useRef({ o: -1, share: -1, own: false })
  const reported = useRef(-1)
  const auto = streetsLook === 'auto'
  // The pieces under a route line are left out (not at a station with an interior: its tracks sink under it).
  const clip = useMemo(
    () => (clipped ? buildRouteClip(localTracks(network.shapes, layer.anchor, layer.file.radiusM + CLIP_TRACK_REACH_M)) : null),
    [clipped, network, layer],
  )
  const fullRoute = useMemo(() => routeCut(layer.buffers, clip), [layer, clip])
  const veiledRoute = useMemo(() => (auto ? routeCut(layer.veiledBuffers, clip) : null), [auto, layer, clip])
  // The cell's key names the overlapping layers, which fix its planes: an unchanged key keeps the buffers, and a new
  // neighbour re-cuts only by the cell, not the route clip.
  const fullBuffers = useMemo(() => clipToCell(fullRoute, cell), [fullRoute, cell.key])
  const veiledBuffers = useMemo(() => veiledRoute && clipToCell(veiledRoute, cell), [veiledRoute, cell.key])
  const full = useLineLayer(fullBuffers, streetsLook === 'over' ? RENDER_ORDER.streetsOver : RENDER_ORDER.streets, theme.streetWidth, undefined, { dimmable: true })
  const veiled = useLineLayer(veiledBuffers, RENDER_ORDER.streetsOver, theme.streetWidth, undefined, { dimmable: true })
  const rgb = focused ? MARK_RGB : NEIGHBOUR_MARK_RGB
  const allMarks = useMemo(
    () => (interiorPending ? null : entranceMarkBuffers(layer.file, unmatchedEntrances(layer.file, layer.anchor, null), ENTRANCE_SIZE_M, rgb)),
    [layer, interiorPending, rgb],
  )
  const ownMarks = useMemo(() => {
    if (interiorPending || !interior) return null
    const at = { origin: interior.origin, entrances: interior.entrances }
    return entranceMarkBuffers(layer.file, unmatchedEntrances(layer.file, layer.anchor, at), ENTRANCE_SIZE_M, rgb)
  }, [layer, interior, interiorPending, rgb])
  const marksAll = useLineLayer(allMarks, RENDER_ORDER.streetEntrance, theme.interiorFineWidth)
  const marksOwn = useLineLayer(ownMarks, RENDER_ORDER.streetEntrance, theme.interiorFineWidth)
  const slot = useRef<number | null>(null)
  useLayoutEffect(() => {
    // A full mask has logged; this layer then draws over the roads it would mask.
    const s = claimMaskSlot(mask)
    slot.current = s
    if (s === null) return
    writeMaskSlot(mask, s, layer.anchor.x, layer.anchor.z, layer.file.radiusM)
    writeMaskStrength(mask, s, presence.value)
    return () => {
      slot.current = null
      releaseMaskSlot(mask, s)
    }
  }, [layer, mask, presence])
  // A rebuilt layer starts at full opacity: catch it up.
  useLayoutEffect(() => {
    shown.current.o = -1
  }, [full, veiled, marksAll, marksOwn])

  // With the other presences (PresenceDriver), before the draws and the basemap's mask at 0 read them.
  useFrame((_, dt) => {
    const v = stepPresence(presence, dt, prefersReducedMotion())
    if (slot.current !== null) writeMaskStrength(mask, slot.current, v)
    // Each end reported once per approach: 0 while leaving, 1 while joining.
    const end = presence.target === 0 ? (v === 0 ? 0 : -1) : v === 1 ? 1 : -1
    if (end !== reported.current && end !== -1) {
      if (end === 0) onFaded(layer.stationId)
      else onSettled()
    }
    reported.current = end
  }, -0.25)

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const o = interiorOpacity(cameraDistance(state)) * presence.value
    // The two strokes cross-fade by the veil's drawn share, so the streets follow it exactly and never lead it.
    const share = veiled === null ? 0 : veil.veilShare
    const own = marksOwn !== null && (interiorPresence?.value ?? 1) > INTERIOR_MARKS_AT
    if (full) writeLineDim(full.material, tripLevels.networkDim)
    if (veiled) writeLineDim(veiled.material, tripLevels.networkDim)
    const last = shown.current
    // r3f re-applies a moved group's JSX props when the keyed list reorders, so visible stays out of JSX; checked here as a backstop.
    if (o === last.o && share === last.share && own === last.own && g.visible === o > 0) return
    last.o = o
    last.share = share
    last.own = own
    g.visible = o > 0
    if (full) {
      full.material.opacity = o * (1 - share)
      full.visible = share < 1
    }
    if (veiled) {
      veiled.material.opacity = o * share
      veiled.visible = share > 0
    }
    if (marksAll) {
      marksAll.material.opacity = o
      marksAll.visible = !own
    }
    if (marksOwn) {
      marksOwn.material.opacity = o
      marksOwn.visible = own
    }
  })

  return (
    <group ref={group} position={[layer.anchor.x, 0, layer.anchor.z]}>
      {full && <primitive object={full} />}
      {veiled && <primitive object={veiled} />}
      {marksAll && <primitive object={marksAll} />}
      {marksOwn && <primitive object={marksOwn} />}
    </group>
  )
}
