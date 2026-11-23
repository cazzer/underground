import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { interiorStationIds } from '../data/interiorLoad'
import type { StreetLayer } from '../data/useStationStreets'
import { exitEntranceIndex, type ExitLabel } from '../lib/exitView'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { interiorOpacity } from '../lib/interiorReveal'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Network } from '../lib/network'
import type { Presence } from '../lib/presence'
import type { Ground } from '../lib/projection'
import { routeBundles } from '../lib/routeBundles'
import { DESKTOP_LABEL_RADIUS_M, streetLabelOpacity } from '../lib/streetLabelReveal'
import { depthFactor, depthScaleY } from '../lib/tilt'
import { cameraDistance, focusScaleFactor, markerRadiusPx, screenScale } from './cameraDistance'
import { ENTRANCE_SIZE_M, type InteriorModel } from './interiorModel'
import { MARKER_MIN_METERS } from './markerShape'
import { useEntranceProbe } from './useEntranceProbe'
import type { CoveredStation } from './useSceneInteriors'
import { useStreetLabels, type LabelContext } from './useStreetLabels'

export interface StreetLabelsProps {
  /** The focused station's layer. */
  layer: StreetLayer
  /** The focused station's interior, once loaded. */
  interior: InteriorModel | null
  /** Its interior is still loading: no focus ring yet. */
  interiorPending: boolean
  insets: Insets
  panel: ScreenRect | null
  /** The level labels' screen rects, which the street labels keep clear of. */
  labelBlockers: LabelBlockers
  /** For the station markers the labels keep clear of. */
  network: Network
  /** The entrances of the trip's way out and way in (useTripExit, useTripBoard): the first this layer's file has is
   *  placed first and tinted; empty for none. */
  pathLabels: readonly ExitLabel[]
  /** Stations another drawn interior stands in for (useSceneInteriors): a marker faded out by it blocks nothing. */
  covered: readonly CoveredStation[]
}

/** Stations this far beyond the street label radius still block (their marker reaches in), meters. */
const STATION_REACH_M = DESKTOP_LABEL_RADIUS_M + 50

interface Nearby {
  ids: string[]
  points: Ground[]
}

/** The stations near the layer that may draw a marker: not the focused one, nor the members its interior covers
 *  (their markers are hidden with it). */
function nearbyStations(network: Network, layer: StreetLayer, interior: InteriorModel | null): Nearby {
  const hidden = new Set(interior ? interiorStationIds(interior) : [])
  const near = network.stations
    .filter((s) => s.id !== layer.stationId && !hidden.has(s.id))
    .filter((s) => Math.hypot(s.pos.x - layer.anchor.x, s.pos.z - layer.anchor.z) <= STATION_REACH_M)
  return { ids: near.map((s) => s.id), points: near.map((s) => s.pos) }
}

/**
 * The focused station's street and entrance labels (useStreetLabels.ts), and its dev entrance probe. A nearby station
 * whose marker a view interior has faded out (Stations.tsx collapses it once interiorOpacity x presence reaches 1)
 * blocks no label; the flag is checked per frame and only a change places the labels again, with no DOM rebuild.
 */
export function StreetLabels({ layer, interior, interiorPending, insets, panel, labelBlockers, network, pathLabels, covered }: StreetLabelsProps) {
  const labelShown = useRef(0)
  const labelContext = useRef<LabelContext>({
    interior: null,
    focusRing: null,
    depthScale: 1,
    markerRadiusM: 0,
    ringRadiusM: 0,
    priorityEntrance: -1,
    markerHidden: null,
    markersVersion: 0,
  })
  // The other stations whose markers the labels keep clear of; the focused one draws none, or a focus ring.
  const near = useMemo(() => nearbyStations(network, layer, interior), [network, layer, interior])
  // Per nearby station, the presence of the view interior standing in for it, or null.
  const coverOf = useMemo(() => {
    const byId = new Map(covered.map((c) => [c.id, c.presence]))
    return near.ids.map((id): Presence | null => byId.get(id) ?? null)
  }, [near, covered])
  useLayoutEffect(() => {
    const ctx = labelContext.current
    ctx.markerHidden = new Uint8Array(near.ids.length)
    ctx.markersVersion++
  }, [near])
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
  // The trip path's entrance in this layer's file (any member of a complex shows its own), placed first. A focused
  // station is the To or the From end, never both, so at most one of the labels is in the file.
  const priorityEntrance = useMemo(() => {
    for (const label of pathLabels) {
      const i = exitEntranceIndex(label, layer.file)
      if (i >= 0) return i
    }
    return -1
  }, [pathLabels, layer])

  // Registered before useStreetLabels' frame, which reads what this one writes.
  useFrame((state) => {
    const distance = cameraDistance(state)
    const o = interiorOpacity(distance)
    const depth = depthFactor(distance)
    labelShown.current = streetLabelOpacity(o, depth)
    const ctx = labelContext.current
    ctx.interior = interior
    ctx.focusRing = interior || interiorPending ? null : focused
    ctx.depthScale = depthScaleY(depth)
    ctx.priorityEntrance = priorityEntrance
    // As Stations.tsx and FocusRing.tsx size them at this distance.
    ctx.markerRadiusM = screenScale(distance, markerRadiusPx(distance), MARKER_MIN_METERS)
    ctx.ringRadiusM = ctx.markerRadiusM * focusScaleFactor(distance, ctx.markerRadiusM)
    const hidden = ctx.markerHidden
    if (!hidden || hidden.length !== coverOf.length) return
    for (let k = 0; k < coverOf.length; k++) {
      const p = coverOf[k]
      // Stations.tsx's `gone`: the marker collapses once its fade reaches 1.
      const gone = p && o * p.value >= 1 ? 1 : 0
      if (gone === hidden[k]) continue
      hidden[k] = gone
      ctx.markersVersion++
    }
  })

  useStreetLabels(layer, near.points, bundles, labelShown, labelContext, insetsRef, panelRef, labelBlockers, ENTRANCE_SIZE_M / 2)
  useEntranceProbe(layer, focused, insets, panel)
  return null
}
