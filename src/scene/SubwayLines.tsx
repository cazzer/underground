import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { StationId } from '../data/schema'
import { writeBandView, type BandView } from '../lib/bandOffset'
import { interiorOpacity } from '../lib/interiorReveal'
import type { Network, ShapePath } from '../lib/network'
import { baseLineMix, linesMode, theme } from '../theme'
import { BAND_UNIFORMS } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { LineFade, LineHighlight } from './LineHighlight'
import { RENDER_ORDER } from './renderOrder'
import { routeLineBuffers, useLineLayer } from './useLineLayer'
import { usePlatformFade } from './usePlatformFade'

/** Bands ease in over this long when they arrive after the first paint (networkBands.ts). */
const BAND_EASE_MS = 300
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

interface SubwayLinesProps {
  network: Network
  /** The shapes to draw: network.shapes (no bands) until the banded ones arrive. */
  paths: readonly ShapePath[]
  /** The station whose interior is loaded (null for none): its platform tracks fade out as the interior reveals. */
  interiorStationId: StationId | null
  /** This frame's band view, written here for every band layer and for the trains (LiveTrains reads it). */
  view: BandView
}

/**
 * Every shape of every route, merged into one draw call, with shared corridors drawn as side-by-side bands. Along
 * the loaded interior's platforms the map track fades out as the interior reveals (platformMask.ts), since the
 * interior draws its own track there.
 */
export function SubwayLines({ network, paths, interiorStationId, view }: SubwayLinesProps) {
  const buffers = useMemo(() => routeLineBuffers(network, paths, baseLineMix(theme, linesMode)), [network, paths])
  const lines = useLineLayer(buffers, RENDER_ORDER.lines)
  usePlatformFade(lines, buffers, paths, network, interiorStationId)
  /** When `paths` last changed: new bands ease in from 0 (BandView.ease), which draws exactly as no bands. */
  const swapped = useRef<{ paths: readonly ShapePath[]; atMs: number } | null>(null)

  // Priority -0.25: after CameraRig and the orbit (-2), drei's controls.update() (-1) and the orbit pivot (-0.5),
  // so the view is this frame's camera; before LiveTrains (0), which places the trains on it.
  useFrame((state) => {
    const { camera } = state
    camera.updateMatrixWorld()
    const now = performance.now()
    if (swapped.current?.paths !== paths) swapped.current = { paths, atMs: swapped.current ? now : -Infinity }
    const t = reduceMotion.matches ? 1 : Math.min((now - swapped.current.atMs) / BAND_EASE_MS, 1)
    const ease = t * t * (3 - 2 * t)
    const distance = cameraDistance(state)
    const p11 = camera.projectionMatrix.elements[5]!
    writeBandView(view, camera.matrixWorldInverse.elements, p11, state.size.height, distance, theme.bandPitchPx, network.trackOffsetM, ease)
    BAND_UNIFORMS.bandPitchPx.value = view.pitchPx
    BAND_UNIFORMS.bandEase.value = view.ease
    BAND_UNIFORMS.trackOffsetM.value = view.trackOffsetM
    BAND_UNIFORMS.platformFade.value = interiorStationId === null ? 0 : interiorOpacity(distance)
  }, -0.25)

  return (
    <>
      {lines && <primitive object={lines} />}
      {linesMode === 'a' && <LineHighlight network={network} paths={paths} interiorStationId={interiorStationId} />}
      {linesMode === 'c' && <LineFade network={network} paths={paths} interiorStationId={interiorStationId} />}
    </>
  )
}
