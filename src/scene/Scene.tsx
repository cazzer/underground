import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import type { Insets } from '../lib/framing'
import type { Network } from '../lib/network'
import { theme } from '../theme'
import { CameraRig } from './CameraRig'
import { MapGrid } from './MapGrid'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'
import { Trains } from './Trains'

interface SceneProps {
  network: Network
  insets: Insets
}

export function Scene({ network, insets }: SceneProps) {
  const primaryShapes = useMemo(() => network.shapes.filter((s) => s.primary), [network])
  return (
    <Canvas
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
      <Trains paths={primaryShapes} />
      <CameraRig network={network} insets={insets} />
    </Canvas>
  )
}
