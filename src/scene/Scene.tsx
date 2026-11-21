import { Canvas } from '@react-three/fiber'
import type { LiveLayer } from '../data/useLive'
import type { Insets } from '../lib/framing'
import type { Network } from '../lib/network'
import { theme } from '../theme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { CameraRig } from './CameraRig'
import { LiveTrains } from './LiveTrains'
import { MapGrid } from './MapGrid'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'

interface SceneProps {
  network: Network
  insets: Insets
  /** Placed trips to draw; null draws none. */
  live: LiveLayer | null
  /** A render crash in the live layer: the map stays and the HUD reports it. */
  onLiveError: (error: Error) => void
}

export function Scene({ network, insets, live, onLiveError }: SceneProps) {
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
      <CameraRig network={network} insets={insets} />
    </Canvas>
  )
}
