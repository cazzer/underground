import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { writeBandView, type BandView } from '../lib/bandOffset'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { depthFactor, depthScaleY } from '../lib/tilt'
import { interiorOpacity } from '../lib/interiorReveal'
import type { Network, ShapePath } from '../lib/network'
import type { StationSpans } from '../lib/platformSpan'
import { createEmphasis, createLevels, emphasisLevels, stepEmphasis, type EmphasisTarget } from '../lib/tripEmphasis'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
import { baseLineMix, linesMode, theme } from '../theme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { BAND_UNIFORMS, writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { LineFade, LineHighlight } from './LineHighlight'
import { RENDER_ORDER } from './renderOrder'
import { TripLines } from './TripLines'
import { routeLineBuffers, useLineLayer } from './useLineLayer'
import { usePlatformFade } from './usePlatformFade'

/** Bands ease in over this long when they arrive after the first paint (networkBands.ts). */
const BAND_EASE_MS = 300

interface SubwayLinesProps {
  network: Network
  /** The shapes to draw: network.shapes (no bands) until the banded ones arrive. */
  paths: readonly ShapePath[]
  /** The loaded interior's platform spans, every member of a complex unioned (null for none): that track fades out as the interior reveals. */
  interiorSpans: StationSpans | null
  /** This frame's band view (incl. its depth factor), written here for every band layer and for the trains (LiveTrains reads it). */
  view: BandView
  /** The selected journey's ride legs (useTripRoute); null with none. */
  tripRoute: TripRouteDraw | null
  /** The trip panel is in front (collapsed or not): its route draws and the rest of the network dims. */
  tripShown: boolean
}

/**
 * Every shape of every route, merged into one draw call, with shared corridors drawn as side-by-side bands. Along
 * the loaded interior's platforms the map track fades out as the interior reveals (platformMask.ts), since the
 * interior draws its own track there. While the trip panel is in front with a route, the network dims toward the
 * background by color (every layer's own `lineDim`) and TripLines draws the route over it, eased over EMPHASIS_S.
 */
export function SubwayLines({ network, paths, interiorSpans, view, tripRoute, tripShown }: SubwayLinesProps) {
  const buffers = useMemo(() => routeLineBuffers(network, paths, baseLineMix(theme, linesMode), true), [network, paths])
  const lines = useLineLayer(buffers, RENDER_ORDER.lines)
  usePlatformFade(lines, buffers, paths, interiorSpans)
  /** When `paths` last changed: new bands ease in from 0 (BandView.ease), which draws exactly as no bands. */
  const swapped = useRef<{ paths: readonly ShapePath[]; atMs: number } | null>(null)
  const emphasis = useMemo(createEmphasis, [])
  const target = useMemo<EmphasisTarget>(() => ({ shown: false, full: false }), [])
  /** Written here each frame, read by every line layer (TripLines and the ?lines= overlays, at 0). */
  const levels = useMemo(() => createLevels(theme), [])

  // Priority -0.25: after CameraRig and the orbit (-2), drei's controls.update() (-1) and the orbit pivot (-0.5),
  // so the view is this frame's camera; before LiveTrains (0), which places the trains on it.
  useFrame((state, delta) => {
    const { camera } = state
    camera.updateMatrixWorld()
    const now = performance.now()
    if (swapped.current?.paths !== paths) swapped.current = { paths, atMs: swapped.current ? now : -Infinity }
    const t = prefersReducedMotion() ? 1 : Math.min((now - swapped.current.atMs) / BAND_EASE_MS, 1)
    const ease = t * t * (3 - 2 * t)
    const distance = cameraDistance(state)
    const p11 = camera.projectionMatrix.elements[5]!
    const depth = depthFactor(distance)
    writeBandView(view, camera.matrixWorldInverse.elements, p11, state.size.height, distance, theme.bandPitchPx, network.trackOffsetM, ease, depth)
    // The profile's depth shows with the tilt; scale.y only, so the band shader's horizontal math is unchanged.
    if (lines) lines.scale.y = depthScaleY(depth)
    BAND_UNIFORMS.bandPitchPx.value = view.pitchPx
    BAND_UNIFORMS.bandEase.value = view.ease
    BAND_UNIFORMS.trackOffsetM.value = view.trackOffsetM
    BAND_UNIFORMS.platformFade.value = interiorSpans === null ? 0 : interiorOpacity(distance)
    target.shown = tripShown && tripRoute !== null
    target.full = tripRoute?.faint === false
    stepEmphasis(emphasis, target, delta, prefersReducedMotion())
    emphasisLevels(emphasis, theme, levels)
    if (lines) writeLineDim(lines.material, levels.networkDim)
  }, -0.25)

  return (
    <>
      {lines && <primitive object={lines} />}
      {linesMode === 'a' && <LineHighlight network={network} paths={paths} interiorSpans={interiorSpans} levels={levels} />}
      {linesMode === 'c' && <LineFade network={network} paths={paths} interiorSpans={interiorSpans} levels={levels} />}
      {/* Decoration: a crash here (logged by the boundary) draws no trip route instead of blanking the scene. */}
      <ErrorBoundary fallback={null}>
        <TripLines network={network} paths={paths} route={tripRoute} levels={levels} interiorSpans={interiorSpans} />
      </ErrorBoundary>
    </>
  )
}
