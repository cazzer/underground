import { Canvas } from '@react-three/fiber'
import type { LiveLayer } from '../data/useLive'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { theme } from '../theme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { CameraRig } from './CameraRig'
import type { InteriorModel } from './interiorModel'
import { LiveTrains } from './LiveTrains'
import { MapGrid } from './MapGrid'
import { StationInterior } from './StationInterior'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'

interface SceneProps {
  network: Network
  insets: Insets
  /** Placed trips to draw; null draws none. */
  live: LiveLayer | null
  /** A render crash in the live layer: the map stays and the HUD reports it. */
  onLiveError: (error: Error) => void
  /** The focused station's interior, once loaded. */
  interior: InteriorModel | null
  /** The station panel's screen rect; interior fly-tos frame beside it. */
  panel: ScreenRect | null
  onInteriorRevealed: (revealed: boolean) => void
}

export function Scene({ network, insets, live, onLiveError, interior, panel, onInteriorRevealed }: SceneProps) {
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
      <SubwayLines network={network} />
      <Stations stations={network.stations} />
      {live && (
        <ErrorBoundary fallback={null} onError={onLiveError}>
          <LiveTrains {...live} network={network} />
        </ErrorBoundary>
      )}
      {interior && (
        <StationInterior key={interior.stationId} model={interior} network={network} onRevealed={onInteriorRevealed} />
      )}
      <CameraRig network={network} insets={insets} panel={panel} interior={interior} />
    </Canvas>
  )
}
