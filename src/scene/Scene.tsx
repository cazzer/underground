import { Canvas } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BASEMAP } from '../data/basemapConfig'
import { hiddenSiblingIds, interiorStationIds, type IndexLoad } from '../data/interiorLoad'
import type { LiveLayer } from '../data/useLive'
import { createBandView } from '../lib/bandOffset'
import { createStreetMask } from '../lib/basemap/streetMask'
import type { Insets } from '../lib/framing'
import { createFollowAnchor } from '../lib/live/followAnchor'
import type { TrainPickSource } from '../lib/live/trainPick'
import type { ScreenRect } from '../lib/interiorCamera'
import { createLabelBlockers } from '../lib/labelBlockers'
import { outageFramePoints } from '../lib/outageFrame'
import { priorityFrameOf } from '../lib/pathFrame'
import { RAIL_DROP_M, STEP_RISE_M } from '../lib/interiorGeometry'
import type { ExitLabel } from '../lib/exitView'
import { BOARD_HALF_M, type StationPathDraw } from '../lib/interiorPath'
import type { Network } from '../lib/network'
import { deckSpans, memberSpans } from '../lib/platformSpan'
import type { BandedShapes } from '../lib/networkBands'
import type { Ground } from '../lib/projection'
import { theme } from '../theme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { Basemap } from './Basemap'
import { basemapLook } from './basemapLook'
import { CameraRig } from './CameraRig'
import type { InteriorModel } from './interiorModel'
import { LiveTrains } from './LiveTrains'
import { MapGrid } from './MapGrid'
import { ScenePicker } from './ScenePicker'
import { StationInterior } from './StationInterior'
import { StationStreets } from './StationStreets'
import { StationTies } from './StationTies'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'
import { YouAreHere } from './YouAreHere'

/** TEMPORARY `?basemap=off` (basemapLook.ts) draws no basemap and loads no tiles. */
const basemapConfig = basemapLook === 'off' ? null : BASEMAP

const NO_DECKS: ReadonlyMap<string, number> = new Map()

interface SceneProps {
  network: Network
  /** The banded shapes, once found after the first paint (null draws network.shapes, without bands). */
  banded: BandedShapes | null
  insets: Insets
  /** Placed trips to draw; null draws none. */
  live: LiveLayer | null
  /** A render crash in the live layer: the map stays and the HUD reports it. */
  onLiveError: (error: Error) => void
  /** The focused station's interior, once loaded. */
  interior: InteriorModel | null
  /** Ids of the interior's machines that are out of service, sorted. */
  outOfService: readonly string[]
  /** The focused station draws its own street marker and tie: it has no interior, or its load failed. */
  focusedMarker: boolean
  /** The focused station's complex siblings from the index (empty for a lone station); hidden once the interior that covers them is loaded. */
  siblings: readonly string[]
  /** The station index, from which the camera finds the focused and the closed station's complex. */
  index: IndexLoad
  /** The station panel's screen rect; interior fly-tos frame beside it. */
  panel: ScreenRect | null
  /** The user's location, once found inside the covered area; null draws no marker. */
  here: { ground: Ground; accuracyM: number } | null
  /** The trip's way out at its To station and its transfers through complexes, by interior file id; each draws only
   *  while its interior is the focused one (the first for an interior wins). */
  stationPaths: readonly StationPathDraw[]
  /** The trip's drawn exit's label, which the street labels place first; null for none. */
  exitLabel: ExitLabel | null
  /** The trip panel is open: a landing there goes on framing the trip's path above the panel as it changes. */
  tripOpen: boolean
}

export function Scene({ network, banded, insets, live, onLiveError, interior, outOfService, focusedMarker, siblings, index, panel, here, stationPaths, exitLabel, tripOpen }: SceneProps) {
  const trainPick = useRef<TrainPickSource | null>(null)
  /** Written by SubwayLines each frame, read by LiveTrains: lines and trains share one band view. */
  const bandView = useMemo(createBandView, [])
  /** Written by LiveTrains at -3, read by CameraRig: the selected train the camera follows. */
  const anchor = useMemo(createFollowAnchor, [])
  /** Written by StationStreets, read by Basemap: the basemap's roads give way to the focused station's streets. */
  const streetMask = useMemo(createStreetMask, [])
  /** The loaded interior's platform spans, unioned over a complex's members: the track fades and cars lift along all of them. */
  const interiorSpans = useMemo(
    () => (interior ? memberSpans(network.platformSpans, interiorStationIds(interior)) : null),
    [interior, network],
  )
  /** The same spans split by the deck each track rides, so each deck's trains draw between its strokes and the next band's. */
  const spansByDeck = useMemo(
    () => deckSpans(interiorSpans, interior?.trackDecks ?? NO_DECKS, interior?.decks.length ?? 0),
    [interiorSpans, interior],
  )
  // The index says who shares the file; the model says who it draws. Their markers and ties go with the focused one's.
  const hiddenSiblings = useMemo(() => hiddenSiblingIds(siblings, interior), [siblings, interior])
  /** The trip's path the focused interior draws (the first listed for it): its way out or a change of trains. */
  const path = interior ? (stationPaths.find((p) => p.interiorId === interior.stationId)?.choice ?? null) : null
  // `outOfService` is a new array every render: its ids say when the machines out really change.
  const outKey = outOfService.join(',')
  const outages = useMemo(() => (interior ? outageFramePoints(interior, outOfService, interior.yScale) : []), [interior, outKey])
  /** What a flight there frames first (the path, then the machines out); a complex's members anchor its target. */
  const priorityFrame = useMemo(() => {
    if (!interior) return null
    const anchors = interiorStationIds(interior).flatMap((id) => network.stationById.get(id)?.pos ?? [])
    return priorityFrameOf(interior, path, outages, anchors, { stepRise: STEP_RISE_M, railDrop: RAIL_DROP_M, boardHalfM: BOARD_HALF_M })
  }, [interior, path, outages, network])
  /** Written by the level labels each frame, read by the street labels: their screen rects. */
  const labelBlockers = useMemo(() => createLabelBlockers(), [])
  return (
    <Canvas
      // No tone mapping, so every theme token renders as the exact color it names.
      flat
      // `far` is set by CameraRig from the fitted zoom range.
      camera={{ fov: 35, near: 10 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      aria-label="Subway map"
    >
      <color attach="background" args={[theme.background]} />
      <MapGrid />
      <SubwayLines network={network} paths={banded?.shapes ?? network.shapes} interiorSpans={interiorSpans} view={bandView} />
      <StationTies network={network} focusedMarker={focusedMarker} hiddenSiblings={hiddenSiblings} />
      <Stations stations={network.stations} focusedMarker={focusedMarker} hiddenSiblings={hiddenSiblings} />
      <ScenePicker stations={network.stations} trainPick={trainPick} hiddenSiblings={hiddenSiblings} />
      {live && (
        <ErrorBoundary fallback={null} onError={onLiveError}>
          <LiveTrains {...live} network={network} trainPick={trainPick} deckSpans={spansByDeck} view={bandView} anchor={anchor} />
        </ErrorBoundary>
      )}
      {here && <YouAreHere ground={here.ground} accuracyM={here.accuracyM} />}
      <StationStreets
        interior={interior}
        interiorPending={!interior && !focusedMarker}
        insets={insets}
        panel={panel}
        labelBlockers={labelBlockers}
        network={network}
        mask={streetMask}
        exitLabel={exitLabel}
      />
      {interior && (
        <StationInterior
          key={interior.stationId}
          model={interior}
          network={network}
          outOfService={outOfService}
          labelBlockers={labelBlockers}
          path={path}
        />
      )}
      <CameraRig
        network={network}
        insets={insets}
        panel={panel}
        interior={interior}
        index={index}
        anchor={anchor}
        frame={priorityFrame}
        tripOpen={tripOpen}
      />
      {basemapConfig && (
        // Decoration: a crash here (logged by the boundary, once) draws no basemap instead of blanking the scene.
        <ErrorBoundary fallback={null}>
          <Basemap config={basemapConfig} stations={network.stations} mask={streetMask} shapes={network.shapes} />
        </ErrorBoundary>
      )}
    </Canvas>
  )
}
