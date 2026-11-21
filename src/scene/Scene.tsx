import { Grid } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Material, type Mesh } from 'three'
import { network } from '../lib/network'
import { theme } from '../theme'
import { CameraRig } from './CameraRig'
import { Stations } from './Stations'
import { SubwayLines } from './SubwayLines'
import { Trains } from './Trains'

export function Scene() {
  const grid = useRef<Mesh>(null)
  // drei's Grid forwards props to the mesh, not its material. It's transparent, so it renders
  // with the transparent list; skip depth writes so it never occludes anything drawn after it.
  useLayoutEffect(() => {
    if (grid.current?.material instanceof Material) grid.current.material.depthWrite = false
  }, [])

  return (
    <Canvas
      camera={{ fov: 35, near: 10, far: 40_000 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      aria-label="Subway map"
    >
      <color attach="background" args={[theme.background]} />
      <Grid
        ref={grid}
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
