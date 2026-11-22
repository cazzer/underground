import { Canvas } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BASEMAP } from '../data/basemapConfig'
import { hiddenSiblingIds, interiorStationIds, type IndexLoad } from '../data/interiorLoad'
import type { LiveLayer } from '../data/useLive'
import { createBandView } from '../lib/bandOffset'
import type { Insets } from '../lib/framing'
import { createFollowAnchor } from '../lib/live/followAnchor'
import type { TrainPickSource } from '../lib/live/trainPick'
import type { ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { memberSpans } from '../lib/platformSpan'
import type { BandedShapes } from '../lib/networkBands'
import type { Ground } from '../lib/projection'
import { theme } from '../theme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { BasemapProbe } from './BasemapProbe'
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

/** Until the basemap draws (ost.9.3), its tiles load only under `?debug` in dev, to check the tile source. */
const basemapProbe = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug') ? BASEMAP : null

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
}

export function Scene({ network, banded, insets, live, onLiveError, interior, outOfService, focusedMarker, siblings, index, panel, here }: SceneProps) {
  const trainPick = useRef<TrainPickSource | null>(null)
  /** Written by SubwayLines each frame, read by LiveTrains: lines and trains share one band view. */
  const bandView = useMemo(createBandView, [])
  /** Written by LiveTrains at -3, read by CameraRig: the selected train the camera follows. */
  const anchor = useMemo(createFollowAnchor, [])
  /** The loaded interior's platform spans, unioned over a complex's members: the track fades and cars lift along all of them. */
  const interiorSpans = useMemo(
    () => (interior ? memberSpans(network.platformSpans, interiorStationIds(interior)) : null),
    [interior, network],
  )
  // The index says who shares the file; the model says who it draws. Their markers and ties go with the focused one's.
  const hiddenSiblings = useMemo(() => hiddenSiblingIds(siblings, interior), [siblings, interior])
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
          <LiveTrains {...live} network={network} trainPick={trainPick} interiorSpans={interiorSpans} view={bandView} anchor={anchor} />
        </ErrorBoundary>
      )}
      {here && <YouAreHere ground={here.ground} accuracyM={here.accuracyM} />}
      <StationStreets interior={interior} interiorPending={!interior && !focusedMarker} insets={insets} panel={panel} />
      {interior && <StationInterior key={interior.stationId} model={interior} network={network} outOfService={outOfService} />}
      <CameraRig network={network} insets={insets} panel={panel} interior={interior} index={index} anchor={anchor} />
      {basemapProbe && <BasemapProbe config={basemapProbe} />}
    </Canvas>
  )
}
