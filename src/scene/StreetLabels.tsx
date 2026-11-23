import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { interiorStationIds } from '../data/interiorLoad'
import type { StreetLayer } from '../data/useStationStreets'
import { exitEntranceIndex, type ExitLabel } from '../lib/exitView'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { interiorOpacity } from '../lib/interiorReveal'
import type { LabelBlockers } from '../lib/labelBlockers'
import { nearbyMarkers } from '../lib/labelNearby'
import { labelStationOrder } from '../lib/labelStationOrder'
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
import { useStreetLabels, type LabelContext, type LabelStation } from './useStreetLabels'

export interface StreetLabelsProps {
  /** Every mounted street layer (StationStreets' shown list: drawn, then leaving). */
  layers: readonly StreetLayer[]
  /** Each layer's presence, by station id: its labels fade with it. */
  presences: ReadonlyMap<string, Presence>
  /** The focused station's layer while it is drawn, else null: its labels place first and unbudgeted. */
  focusedLayer: StreetLayer | null
  /** The focused station's own interior, once loaded. */
  interior: InteriorModel | null
  /** Its interior is still loading: no focus ring yet. */
  interiorPending: boolean
  /** Every drawn interior: the street names keep clear of their outlines. */
  interiors: readonly InteriorModel[]
  insets: Insets
  panel: ScreenRect | null
  /** The level labels' screen rects, which the street labels keep clear of. */
  labelBlockers: LabelBlockers
  /** For the station markers the labels keep clear of. */
  network: Network
  /** The entrances of the trip's way out and way in (useTripExit, useTripBoard): the first the focused layer's file
   *  has is placed first and tinted; empty for none. */
  pathLabels: readonly ExitLabel[]
  /** Stations another drawn interior stands in for (useSceneInteriors): a marker faded out by it blocks nothing. */
  covered: readonly CoveredStation[]
}

/** Stations this far beyond the street label radius still block (their marker reaches in), meters. */
const STATION_REACH_M = DESKTOP_LABEL_RADIUS_M + 50

function EntranceProbe(props: { layer: StreetLayer; station: Ground | null; insets: Insets; panel: ScreenRect | null }) {
  useEntranceProbe(props.layer, props.station, props.insets, props.panel)
  return null
}

/**
 * The street and entrance labels of every mounted street layer, in one declutter pass (useStreetLabels.ts, o3r.6):
 * the focused station's first, then the others in the order they joined (labelStationOrder.ts), so a station joining
 * never moves the labels already placed. They all keep clear of every layer's entrance marks and of the station
 * markers within reach of any layer, but the focused station's and those its interior covers. A nearby station whose
 * marker a view interior has faded out (Stations.tsx collapses it once interiorOpacity x presence reaches 1) blocks
 * no label; the flag is checked per frame and only a change places the labels again. Also the focused station's dev
 * entrance probe.
 */
export function StreetLabels(props: StreetLabelsProps) {
  const { layers, presences, focusedLayer, interior, interiorPending, interiors, insets, panel, labelBlockers, network, pathLabels, covered } = props
  const labelShown = useRef(0)
  const labelContext = useRef<LabelContext>({
    interiors: [],
    focusRing: null,
    depthScale: 1,
    markerRadiusM: 0,
    ringRadiusM: 0,
    focusedFirst: false,
    priorityEntrance: -1,
    markerHidden: null,
    markersVersion: 0,
  })
  const focusedId = focusedLayer?.stationId ?? null
  // The label order: adjusted during render, so a new set never places one frame in the wrong order.
  const ids = useMemo(() => layers.map((l) => l.stationId), [layers])
  const [order, setOrder] = useState<readonly string[]>([])
  const nextOrder = labelStationOrder(order, ids, focusedId)
  if (nextOrder !== order) setOrder(nextOrder)
  // Which street candidates a subway line runs along, so their labels step clear of its bundle; once per layer.
  const bundleCache = useRef<{ network: Network; byLayer: WeakMap<StreetLayer, Float32Array[][]> } | null>(null)
  const stations = useMemo((): LabelStation[] => {
    if (bundleCache.current?.network !== network) bundleCache.current = { network, byLayer: new WeakMap() }
    const cache = bundleCache.current.byLayer
    const byId = new Map(layers.map((l) => [l.stationId, l]))
    return nextOrder.flatMap((id) => {
      const layer = byId.get(id)
      if (!layer) return []
      let bundles = cache.get(layer)
      if (!bundles) {
        bundles = routeBundles(layer.streets, layer.anchor, network.shapes, STATION_REACH_M)
        cache.set(layer, bundles)
      }
      return [{ layer, bundles, presence: presences.get(id) ?? null }]
    })
  }, [nextOrder, layers, presences, network])
  // The other stations whose markers the labels keep clear of; the focused one draws none, or a focus ring.
  const near = useMemo(() => {
    const excluded = new Set<string>(focusedId ? [focusedId, ...(interior ? interiorStationIds(interior) : [])] : [])
    return nearbyMarkers(network.stations, layers.map((l) => l.anchor), excluded, STATION_REACH_M)
  }, [network, layers, focusedId, interior])
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
  const focused = focusedId ? (network.stationById.get(focusedId)?.pos ?? null) : null
  const insetsRef = useRef(insets)
  const panelRef = useRef(panel)
  // Read per frame by the labels; synced after commit, before the next frame.
  useLayoutEffect(() => {
    insetsRef.current = insets
    panelRef.current = panel
  }, [insets, panel])
  // The trip path's entrance in the focused layer's file (any member of a complex shows its own), placed first. A
  // focused station is the To or the From end, never both, so at most one of the labels is in the file.
  const priorityEntrance = useMemo(() => {
    if (!focusedLayer) return -1
    for (const label of pathLabels) {
      const i = exitEntranceIndex(label, focusedLayer.file)
      if (i >= 0) return i
    }
    return -1
  }, [pathLabels, focusedLayer])

  // Registered before useStreetLabels' frame, which reads what this one writes.
  useFrame((state) => {
    const distance = cameraDistance(state)
    const o = interiorOpacity(distance)
    const depth = depthFactor(distance)
    labelShown.current = streetLabelOpacity(o, depth)
    const ctx = labelContext.current
    ctx.interiors = interiors
    ctx.focusRing = !focusedLayer || interior || interiorPending ? null : focused
    ctx.depthScale = depthScaleY(depth)
    ctx.focusedFirst = focusedLayer !== null
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

  useStreetLabels(stations, near.points, labelShown, labelContext, insetsRef, panelRef, labelBlockers, ENTRANCE_SIZE_M / 2)
  return focusedLayer ? <EntranceProbe layer={focusedLayer} station={focused} insets={insets} panel={panel} /> : null
}
