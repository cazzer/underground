import { Grid } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import type { Network } from '../lib/network'
import { theme } from '../theme'
import { CameraRig } from './CameraRig'
import { RENDER_ORDER } from './renderOrder'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'
import { Trains } from './Trains'

interface SceneProps {
  network: Network
}

export function Scene({ network }: SceneProps) {
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
      <Grid
        infiniteGrid
        // The plane follows the camera and spans the whole fade radius (its size is args x
        // fadeDistance), so the grid exists anywhere in the city and has no hard square edge.
        followCamera
        args={[2, 2]}
        renderOrder={RENDER_ORDER.grid}
        position={[0, -0.5, 0]}
        cellSize={100}
        sectionSize={1000}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor={theme.gridCell}
        sectionColor={theme.gridSection}
        fadeDistance={14_000}
        fadeStrength={1.5}
      />
      <SubwayLines network={network} />
      <Stations stations={network.stations} />
      <Trains paths={primaryShapes} />
      <CameraRig network={network} />
    </Canvas>
  )
}
