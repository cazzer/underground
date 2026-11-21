import { Grid } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { network } from '../lib/network'
import { theme } from '../theme'
import { CameraRig } from './CameraRig'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'
import { Trains } from './Trains'

export function Scene() {
  return (
    <Canvas
      camera={{ fov: 35, near: 1, far: 40_000 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      aria-label="Subway map"
    >
      <color attach="background" args={[theme.background]} />
      <Grid
        infiniteGrid
        renderOrder={-1}
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
      <SubwayLines />
      <Stations />
      <Trains />
      <CameraRig center={network.center} />
    </Canvas>
  )
}
