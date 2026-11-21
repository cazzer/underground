import { Canvas } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { LiveLayer } from '../data/useLive'
import { createBandView } from '../lib/bandOffset'
import type { Insets } from '../lib/framing'
import type { TrainPickSource } from '../lib/live/trainPick'
import type { ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import type { BandedShapes } from '../lib/networkBands'
import type { Ground } from '../lib/projection'
import { theme } from '../theme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { CameraRig } from './CameraRig'
import type { InteriorModel } from './interiorModel'
import { LiveTrains } from './LiveTrains'
import { MapGrid } from './MapGrid'
import { ScenePicker } from './ScenePicker'
import { StationInterior } from './StationInterior'
import { StationTies } from './StationTies'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'
import { YouAreHere } from './YouAreHere'

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
  /** The focused station draws its own street marker and tie: it has no interior, or its load failed. */
  focusedMarker: boolean
  /** The station panel's screen rect; interior fly-tos frame beside it. */
  panel: ScreenRect | null
  /** The user's location, once found inside the covered area; null draws no marker. */
  here: { ground: Ground; accuracyM: number } | null
}

export function Scene({ network, banded, insets, live, onLiveError, interior, focusedMarker, panel, here }: SceneProps) {
  const trainPick = useRef<TrainPickSource | null>(null)
  /** Written by SubwayLines each frame, read by LiveTrains: lines and trains share one band view. */
  const bandView = useMemo(createBandView, [])
  const interiorStationId = interior?.stationId ?? null
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
      <SubwayLines network={network} paths={banded?.shapes ?? network.shapes} interiorStationId={interiorStationId} view={bandView} />
      <StationTies network={network} focusedMarker={focusedMarker} />
      <Stations stations={network.stations} focusedMarker={focusedMarker} />
      <ScenePicker stations={network.stations} trainPick={trainPick} />
      {live && (
        <ErrorBoundary fallback={null} onError={onLiveError}>
          <LiveTrains {...live} network={network} trainPick={trainPick} interiorStationId={interiorStationId} view={bandView} />
        </ErrorBoundary>
      )}
      {here && <YouAreHere ground={here.ground} accuracyM={here.accuracyM} />}
      {interior && <StationInterior key={interior.stationId} model={interior} network={network} />}
      <CameraRig network={network} insets={insets} panel={panel} interior={interior} />
    </Canvas>
  )
}
