import { Canvas } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { BASEMAP } from '../data/basemapConfig'
import { interiorStationIds, type IndexLoad } from '../data/interiorLoad'
import type { LiveLayer } from '../data/useLive'
import { createBandView } from '../lib/bandOffset'
import { createLocationCap } from '../lib/basemap/locationCapHandle'
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
import type { BandedShapes } from '../lib/networkBands'
import type { Ground } from '../lib/projection'
import { createLevels } from '../lib/tripEmphasis'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
import { theme } from '../theme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { Basemap } from './Basemap'
import { basemapLook } from './basemapLook'
import { CameraRig } from './CameraRig'
import type { InteriorModel } from './interiorModel'
import { LiveTrains } from './LiveTrains'
import { createViewStationSet } from '../lib/viewStationSet'
import { LocationCapSource } from './LocationCapSource'
import { ViewStationsSource } from './ViewStationsSource'
import { ScenePicker } from './ScenePicker'
import { ScreenVeil } from './ScreenVeil'
import { PresenceDriver } from './InteriorPresence'
import { interiorLook } from './interiorLook'
import { StationInterior } from './StationInterior'
import { StationStreets } from './StationStreets'
import { StationTies } from './StationTies'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'
import { useSceneInteriors } from './useSceneInteriors'
import { ViewCenterSource } from './ViewCenterSource'
import { PlacePin } from './PlacePin'
import { YouAreHere } from './YouAreHere'

/** TEMPORARY `?basemap=off` (basemapLook.ts) draws no basemap and loads no tiles. */
const basemapConfig = basemapLook === 'off' ? null : BASEMAP

const NO_IDS: readonly string[] = []

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
  /** The station index, from which the camera finds the focused and the closed station's complex, and the view finds which stations in view have an interior. */
  index: IndexLoad
  /** The station panel's screen rect; interior fly-tos frame beside it. */
  panel: ScreenRect | null
  /** The user's location, once found inside the covered area; null draws no marker. */
  here: { ground: Ground; accuracyM: number } | null
  /** The searched place's ground point while its line shows (the user's search pick, never the fix); null draws no pin. */
  placePin: Ground | null
  /** The trip's way out at its To station, its way in at its From station and its transfers through complexes, by
   *  interior file id; each draws only while its interior is the focused one (the first for an interior wins). */
  stationPaths: readonly StationPathDraw[]
  /** The entrances of the trip's drawn way out and way in, which the street labels place first (the first the shown
   *  file has); empty for none. */
  pathLabels: readonly ExitLabel[]
  /** The trip panel is open: a landing there goes on framing the trip's path above the panel as it changes. */
  tripOpen: boolean
  /** The selected journey's ride legs (useTripRoute); null with none. */
  tripRoute: TripRouteDraw | null
  /** The trip panel is in front: its route draws over the dimmed network. */
  tripShown: boolean
}

export function Scene({ network, banded, insets, live, onLiveError, interior, outOfService, focusedMarker, siblings, index, panel, here, placePin, stationPaths, pathLabels, tripOpen, tripRoute, tripShown }: SceneProps) {
  const trainPick = useRef<TrainPickSource | null>(null)
  /** Written by SubwayLines each frame, read by LiveTrains: lines and trains share one band view. */
  const bandView = useMemo(createBandView, [])
  /** Written by LiveTrains at -3, read by CameraRig: the selected train the camera follows. */
  const anchor = useMemo(createFollowAnchor, [])
  /** Written by SubwayLines at -0.25, read at 0: how far the network (lines, basemap, streets) dims under the trip's route. */
  const tripLevels = useMemo(() => createLevels(theme), [])
  /** Written by StationStreets, read by Basemap: the basemap's roads give way to the drawn station street layers. */
  const streetMask = useMemo(createStreetMask, [])
  /** Driven by LocationCapSource (always mounted), read by Basemap's tile store: the location zoom cap. */
  const locationCap = useState(createLocationCap)[0]
  /** Written by ViewStationsSource: the station leads in view (empty under the cap), whose interiors draw. */
  const viewStations = useState(createViewStationSet)[0]
  /** The focused interior and those of the stations in view (o3r.4), with their spans and the stations they stand in for. */
  const scene = useSceneInteriors(network, interior, viewStations, index, siblings)
  const { shown, presences, spans, spansByDeck, hiddenStations, hiddenSiblings, covered, markHidden, veiled } = scene
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
      <SubwayLines
        network={network}
        paths={banded?.shapes ?? network.shapes}
        interiorSpans={spans}
        veiled={veiled}
        view={bandView}
        tripRoute={tripRoute}
        tripShown={tripShown}
        levels={tripLevels}
        markHidden={markHidden}
        fix={here?.ground ?? null}
      />
      <StationTies network={network} focusedMarker={focusedMarker} hiddenStations={hiddenStations} covered={covered} levels={tripLevels} />
      <Stations
        stations={network.stations}
        focusedMarker={focusedMarker}
        hiddenStations={hiddenSiblings}
        covered={covered}
        tripStations={tripRoute?.stations ?? null}
        tripMarks={tripRoute?.marks ?? null}
        levels={tripLevels}
        fix={here?.ground ?? null}
      />
      <ScenePicker stations={network.stations} trainPick={trainPick} hiddenSiblings={hiddenStations} />
      {live && (
        <ErrorBoundary fallback={null} onError={onLiveError}>
          <LiveTrains {...live} network={network} trainPick={trainPick} deckSpans={spansByDeck} presence={scene.store} view={bandView} anchor={anchor} />
        </ErrorBoundary>
      )}
      {here && <YouAreHere ground={here.ground} accuracyM={here.accuracyM} />}
      {placePin && <PlacePin ground={placePin} />}
      <StationStreets
        interior={interior}
        interiorPending={!interior && !focusedMarker}
        view={scene.view}
        drawn={scene.drawn}
        viewFiles={scene.viewFiles}
        covered={covered}
        index={index}
        veiled={veiled}
        insets={insets}
        panel={panel}
        labelBlockers={labelBlockers}
        network={network}
        mask={streetMask}
        pathLabels={pathLabels}
        tripLevels={tripLevels}
      />
      {/* Each in its own boundary: a crash (logged) draws nothing for that interior instead of blanking the scene. */}
      {shown.map((m) => (
        <ErrorBoundary key={m.stationId} fallback={null}>
          <StationInterior
            model={m}
            network={network}
            outOfService={m === interior ? outOfService : NO_IDS}
            labelBlockers={labelBlockers}
            path={m === interior ? path : null}
            presence={presences.get(m.stationId)!}
            labels={m === interior}
          />
        </ErrorBoundary>
      ))}
      <PresenceDriver store={scene.store} onFaded={scene.onFaded} />
      {interiorLook.veil === 'screen' && <ScreenVeil store={scene.store} />}
      <CameraRig
        network={network}
        insets={insets}
        panel={panel}
        interior={interior}
        index={index}
        anchor={anchor}
        frame={priorityFrame}
        tripOpen={tripOpen}
        tripRoute={tripRoute}
      />
      <ViewCenterSource />
      <LocationCapSource cap={locationCap} />
      <ViewStationsSource network={network} insets={insets} panel={panel} cap={locationCap} set={viewStations} />
      {basemapConfig && (
        // Decoration: a crash here (logged by the boundary, once) draws no basemap instead of blanking the scene.
        <ErrorBoundary fallback={null}>
          <Basemap config={basemapConfig} stations={network.stations} mask={streetMask} shapes={network.shapes} tripLevels={tripLevels} locationCap={locationCap} />
        </ErrorBoundary>
      )}
    </Canvas>
  )
}
