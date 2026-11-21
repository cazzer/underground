import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { createBandView, writeBandView } from '../lib/bandOffset'
import type { Network } from '../lib/network'
import { baseLineMix, linesMode, theme } from '../theme'
import { BAND_UNIFORMS } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { LineFade, LineHighlight } from './LineHighlight'
import { RENDER_ORDER } from './renderOrder'
import { routeLineBuffers, useLineLayer } from './useLineLayer'

interface SubwayLinesProps {
  network: Network
}

/** Every shape of every route, merged into one draw call, with shared corridors drawn as side-by-side bands. */
export function SubwayLines({ network }: SubwayLinesProps) {
  const buffers = useMemo(
    () => routeLineBuffers(network, network.shapes, baseLineMix(theme, linesMode)),
    [network],
  )
  const lines = useLineLayer(buffers, RENDER_ORDER.lines)
  const view = useMemo(createBandView, [])

  // Priority 0: after CameraRig and the orbit (-2), drei's controls.update() (-1) and the orbit pivot (-0.5),
  // so the pitch follows this frame's camera distance; the shader reads this frame's matrices at render.
  useFrame((state) => {
    const { camera } = state
    camera.updateMatrixWorld()
    const p11 = camera.projectionMatrix.elements[5]!
    writeBandView(view, camera.matrixWorldInverse.elements, p11, state.size.height, cameraDistance(state), theme.bandPitchPx, network.trackOffsetM)
    BAND_UNIFORMS.bandPitchPx.value = view.pitchPx
    BAND_UNIFORMS.trackOffsetM.value = view.trackOffsetM
  }, 0)

  return (
    <>
      {lines && <primitive object={lines} />}
      {linesMode === 'a' && <LineHighlight network={network} />}
      {linesMode === 'c' && <LineFade network={network} />}
    </>
  )
}
