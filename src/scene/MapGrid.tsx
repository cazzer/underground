import { Grid } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, type Mesh, type ShaderMaterial } from 'three'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'

/** The grid fades into the background between these camera distances; the overview is clean. */
const FADE_START = 20_000
const FADE_END = 30_000

/** Ground grid. The grid shader ignores material opacity, so it fades by blending its colors into the background. */
export function MapGrid() {
  const mesh = useRef<Mesh>(null)
  const colors = useMemo(
    () => ({ cell: new Color(theme.gridCell), section: new Color(theme.gridSection), bg: new Color(theme.background) }),
    [],
  )
  const lastFade = useRef(-1)

  // drei's grid material writes depth along its lines (it only discards empty pixels), which would cut slashes
  // through the depth-tested train cars wherever the track runs below the street. It draws first, so it needs none.
  useLayoutEffect(() => {
    const m = mesh.current
    if (m) (m.material as ShaderMaterial).depthWrite = false
  }, [])

  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const fade = Math.min(Math.max((cameraDistance(state) - FADE_START) / (FADE_END - FADE_START), 0), 1)
    if (fade === lastFade.current) return
    lastFade.current = fade
    m.visible = fade < 1
    const { uniforms } = m.material as ShaderMaterial
    ;(uniforms.cellColor!.value as Color).lerpColors(colors.cell, colors.bg, fade)
    ;(uniforms.sectionColor!.value as Color).lerpColors(colors.section, colors.bg, fade)
  })

  return (
    <Grid
      ref={mesh}
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
  )
}
