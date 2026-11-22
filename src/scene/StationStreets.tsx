import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, type Group } from 'three'
import { interiorCovers, interiorStationIds } from '../data/interiorLoad'
import { useStationStreets, type StreetLayer } from '../data/useStationStreets'
import type { StreetMask } from '../lib/basemap/streetMask'
import { clipLineBuffers } from '../lib/clipLineBuffers'
import { entranceMarkBuffers, unmatchedEntrances } from '../lib/entranceMarks'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { interiorOpacity } from '../lib/interiorReveal'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Rgb } from '../lib/lineBuffers'
import { DESKTOP_LABEL_RADIUS_M, streetLabelOpacity } from '../lib/streetLabelReveal'
import type { Network } from '../lib/network'
import { routeBundles } from '../lib/routeBundles'
import { buildRouteClip, CLIP_TRACK_REACH_M } from '../lib/routeClip'
import { localTracks } from '../lib/routeTracks'
import type { Ground } from '../lib/projection'
import { depthFactor, depthScaleY } from '../lib/tilt'
import { theme } from '../theme'
import { cameraDistance, focusScaleFactor, markerRadiusPx, screenScale } from './cameraDistance'
import { interiorLook } from './interiorLook'
import { ENTRANCE_SIZE_M, type InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { streetsLook } from './streetsLook'
import { useLineLayer } from './useLineLayer'
import { MARKER_MIN_METERS } from './markerShape'
import { useStreetLabels, type LabelContext } from './useStreetLabels'

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
  /** The level labels' screen rects, which the street labels keep clear of. */
  labelBlockers: LabelBlockers
  /** For the station markers the labels keep clear of. */
  network: Network
  /** Set while a layer is drawn, so the basemap's roads give way inside its radius (Basemap.tsx). */
  mask: StreetMask
}

/**
 * The focused station's streets, interior or not: fetched on focus, drawn while it stays focused, gone with the
 * focus. Keyed by station, so a new station starts hidden and fades in from its own first frame.
 */
export function StationStreets({ interior, ...rest }: StationStreetsProps) {
  const { focusedId } = useFocus()
  const layer = useStationStreets(focusedId)
  if (!layer) return null
  // A complex's interior covers every member: focused on any of them, it is this station's.
  const own = interiorCovers(interior, layer.stationId) ? interior : null
  return <StreetLines key={layer.stationId} layer={layer} interior={own} {...rest} />
}

interface StreetLinesProps extends StationStreetsProps {
  layer: StreetLayer
}

/** Stations this far beyond the street label radius still block (their marker reaches in), meters. */
const STATION_REACH_M = DESKTOP_LABEL_RADIUS_M + 50

/** The stations near the layer whose markers are drawn: not the focused one, nor the members its interior covers
 *  (their markers are hidden with it). */
function nearbyStations(network: Network, layer: StreetLayer, interior: InteriorModel | null): Ground[] {
  const hidden = new Set(interior ? interiorStationIds(interior) : [])
  return network.stations
    .filter((s) => s.id !== layer.stationId && !hidden.has(s.id))
    .filter((s) => Math.hypot(s.pos.x - layer.anchor.x, s.pos.z - layer.anchor.z) <= STATION_REACH_M)
    .map((s) => s.pos)
}

/**
 * How the streets draw: above the interior veil at the veiled stroke (about 1.9:1, streetVeil.ts) with the station's
 * interior loaded under look A (the screen veil), so they rest faint behind the interior instead of vanishing under
 * it; otherwise under the route lines at full color. `?streets=` forces either order, at full color.
 */
function streetMode(interior: InteriorModel | null): 'under' | 'over' | 'veiled' {
  if (streetsLook !== 'auto') return streetsLook
  return interior !== null && interiorLook.veil === 'screen' ? 'veiled' : 'under'
}

/**
 * One merged line layer at street level (y = 0) at the station's anchor, and the marks of the entrances the interior
 * doesn't draw, fading in with the interior reveal; then the street and entrance labels.
 */
function StreetLines({ layer, interior, interiorPending, insets, panel, labelBlockers, network, mask }: StreetLinesProps) {
  const group = useRef<Group>(null)
  const shown = useRef(-1)
  const labelShown = useRef(0)
  const labelContext = useRef<LabelContext>({ interior: null, focusRing: null, depthScale: 1, markerRadiusM: 0, ringRadiusM: 0 })
  // The other stations whose markers the labels keep clear of; the focused one draws none, or a focus ring.
  const stations = useMemo(() => nearbyStations(network, layer, interior), [network, layer, interior])
  // Which street candidates a subway line runs along, so their labels step clear of its bundle.
  const bundles = useMemo(() => routeBundles(layer.streets, layer.anchor, network.shapes, STATION_REACH_M), [network, layer])
  const focused = network.stationById.get(layer.stationId)?.pos ?? null
  const insetsRef = useRef(insets)
  const panelRef = useRef(panel)
  // Read per frame by the labels; synced after commit, before the next frame.
  useLayoutEffect(() => {
    insetsRef.current = insets
    panelRef.current = panel
  }, [insets, panel])
  // The street pieces that run under a route line are left out, so none reads as one more track in its bundle. Not
  // at a station with an interior (loaded or loading): there the tracks sink under it, clear of the streets.
  // While the station index is still loading, every station counts as pending (focusedMarkerShown), so a station
  // with none draws its streets whole for that moment and the pieces under its lines pop out once the index lands.
  // The index is fetched on mount, so only a focus in the page's first moments (a #station link) can show it.
  const clipped = !interior && !interiorPending
  const clip = useMemo(
    () => (clipped ? buildRouteClip(localTracks(network.shapes, layer.anchor, layer.file.radiusM + CLIP_TRACK_REACH_M)) : null),
    [clipped, network, layer],
  )
  const mode = streetMode(interior)
  const buffers = useMemo(() => {
    const base = mode === 'veiled' ? layer.veiledBuffers : layer.buffers
    return clip ? clipLineBuffers(base, clip) : base
  }, [mode, layer, clip])
  const lines = useLineLayer(
    buffers,
    mode === 'under' ? RENDER_ORDER.streets : RENDER_ORDER.streetsOver,
    theme.streetWidth,
  )
  const markBuffers = useMemo(() => {
    if (interiorPending) return null
    const at = interior && { origin: interior.origin, entrances: interior.entrances }
    return entranceMarkBuffers(layer.file, unmatchedEntrances(layer.file, layer.anchor, at), ENTRANCE_SIZE_M, MARK_RGB)
  }, [layer, interior, interiorPending])
  const marks = useLineLayer(markBuffers, RENDER_ORDER.streetEntrance, theme.interiorFineWidth)
  useLayoutEffect(() => {
    mask.present = true
    mask.x = layer.anchor.x
    mask.z = layer.anchor.z
    mask.radiusM = layer.file.radiusM
    return () => {
      mask.present = false
    }
  }, [layer, mask])
  // A rebuilt layer (the mode changes when the interior lands) starts at full opacity: catch it up.
  useLayoutEffect(() => {
    shown.current = -1
  }, [lines])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const distance = cameraDistance(state)
    const o = interiorOpacity(distance)
    const depth = depthFactor(distance)
    labelShown.current = streetLabelOpacity(o, depth)
    const ctx = labelContext.current
    ctx.interior = interior
    ctx.focusRing = interior || interiorPending ? null : focused
    ctx.depthScale = depthScaleY(depth)
    // As Stations.tsx and FocusRing.tsx size them at this distance.
    ctx.markerRadiusM = screenScale(distance, markerRadiusPx(distance), MARKER_MIN_METERS)
    ctx.ringRadiusM = ctx.markerRadiusM * focusScaleFactor(distance, ctx.markerRadiusM)
    if (marks && marks.material.opacity !== o) marks.material.opacity = o
    if (o === shown.current) return
    shown.current = o
    if (lines) lines.material.opacity = o
    g.visible = o > 0
  })

  useStreetLabels(layer, stations, bundles, labelShown, labelContext, insetsRef, panelRef, labelBlockers, ENTRANCE_SIZE_M / 2)

  return (
    <group ref={group} position={[layer.anchor.x, 0, layer.anchor.z]} visible={false}>
      {lines && <primitive object={lines} />}
      {marks && <primitive object={marks} />}
    </group>
  )
}
