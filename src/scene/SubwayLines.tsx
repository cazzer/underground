import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { InstancedBufferAttribute } from 'three'
import type { StationId } from '../data/schema'
import { createBandView, writeBandView } from '../lib/bandOffset'
import { interiorOpacity } from '../lib/interiorReveal'
import type { Network } from '../lib/network'
import { writePlatformFade } from '../lib/platformMask'
import { baseLineMix, linesMode, theme } from '../theme'
import { BAND_UNIFORMS, FADE_ATTRIBUTE } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { LineFade, LineHighlight } from './LineHighlight'
import { RENDER_ORDER } from './renderOrder'
import { routeLineBuffers, useLineLayer } from './useLineLayer'

interface SubwayLinesProps {
  network: Network
  /** The station whose interior is loaded (null for none): its platform tracks fade out as the interior reveals. */
  interiorStationId: StationId | null
}

/**
 * Every shape of every route, merged into one draw call, with shared corridors drawn as side-by-side bands. Along
 * the loaded interior's platforms the map track fades out as the interior reveals (platformMask.ts), since the
 * interior draws its own track there.
 */
export function SubwayLines({ network, interiorStationId }: SubwayLinesProps) {
  const buffers = useMemo(
    () => routeLineBuffers(network, network.shapes, baseLineMix(theme, linesMode)),
    [network],
  )
  const lines = useLineLayer(buffers, RENDER_ORDER.lines)
  const view = useMemo(createBandView, [])

  useEffect(() => {
    if (!lines || !buffers.firstSegment) return
    const fade = lines.geometry.getAttribute(FADE_ATTRIBUTE) as InstancedBufferAttribute
    const spans = (interiorStationId !== null && network.platformSpans.get(interiorStationId)) || null
    writePlatformFade(fade.array as Float32Array, network.shapes, buffers.firstSegment, spans)
    fade.needsUpdate = true
  }, [lines, buffers, network, interiorStationId])

  // Priority 0: after CameraRig and the orbit (-2), drei's controls.update() (-1) and the orbit pivot (-0.5),
  // so the pitch follows this frame's camera distance; the shader reads this frame's matrices at render.
  useFrame((state) => {
    const { camera } = state
    camera.updateMatrixWorld()
    const p11 = camera.projectionMatrix.elements[5]!
    const distance = cameraDistance(state)
    writeBandView(view, camera.matrixWorldInverse.elements, p11, state.size.height, distance, theme.bandPitchPx, network.trackOffsetM)
    BAND_UNIFORMS.bandPitchPx.value = view.pitchPx
    BAND_UNIFORMS.trackOffsetM.value = view.trackOffsetM
    BAND_UNIFORMS.platformFade.value = interiorStationId === null ? 0 : interiorOpacity(distance)
  }, 0)

  return (
    <>
      {lines && <primitive object={lines} />}
      {linesMode === 'a' && <LineHighlight network={network} />}
      {linesMode === 'c' && <LineFade network={network} />}
    </>
  )
}
