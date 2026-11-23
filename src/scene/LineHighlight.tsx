/**
 * TEMPORARY: the ?lines=a and ?lines=c variants for the 8x4.3 look pick. Once a look is chosen,
 * remove together:
 * - this file and its two uses in SubwayLines.tsx (which then passes theme.routeLineMix directly)
 * - theme.ts: `lineMono` (interface field and the three presets), `LinesMode`, `resolveLinesMode`,
 *   `linesMode`, `baseLineMix`
 * - renderOrder.ts: `RENDER_ORDER.lineFocus` (renumber the layers above it)
 * - AGENTS.md: the `?lines=` TEMPORARY note, `LineHighlight.tsx` in the directory map, and
 *   "line focus 2" in the render order list
 */
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { useFocus } from '../lib/focus'
import type { Network, ShapePath } from '../lib/network'
import type { SpanSet } from '../lib/platformSpan'
import { depthFactor, depthScaleY } from '../lib/tilt'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { theme } from '../theme'
import { writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { routeLineBuffers, useLineLayer } from './useLineLayer'
import { usePlatformFade } from './usePlatformFade'

interface LayerProps {
  network: Network
  /** The shapes SubwayLines draws (banded once the bands arrive). */
  paths: readonly ShapePath[]
  /** Its platform tracks fade out with the interior, as SubwayLines' do. */
  interiorSpans: SpanSet | null
  /** SubwayLines' trip emphasis: it dims with the network under the trip's route. */
  levels: EmphasisLevels
}

/** Option A: the focused station's routes, redrawn in route colors over the mono network. */
export function LineHighlight({ network, paths, interiorSpans, levels }: LayerProps) {
  const { focusedId } = useFocus()
  const buffers = useMemo(() => {
    const station = focusedId ? network.stationById.get(focusedId) : undefined
    if (!station) return null
    const routes = new Set(station.routeIds)
    return routeLineBuffers(network, paths.filter((s) => routes.has(s.routeId)), theme.routeLineMix, true)
  }, [network, paths, focusedId])
  const lines = useLineLayer(buffers, RENDER_ORDER.lineFocus)
  usePlatformFade(lines, buffers, paths, interiorSpans)
  // Depth computed here, not read from SubwayLines' band view: a child's frame runs before its parent writes it.
  useFrame((state) => {
    if (!lines) return
    lines.scale.y = depthScaleY(depthFactor(cameraDistance(state)))
    writeLineDim(lines.material, levels.networkDim)
  })
  return lines && <primitive object={lines} />
}

/** Option C: route colors fade in over the mono network between these camera distances. */
const FADE_FAR = 8_000
const FADE_NEAR = 3_000

export function LineFade({ network, paths, interiorSpans, levels }: LayerProps) {
  // Translucent while it fades in, so every variant segment stays drawn: one under its primary would show through.
  const buffers = useMemo(() => routeLineBuffers(network, paths, theme.routeLineMix, false), [network, paths])
  const lines = useLineLayer(buffers, RENDER_ORDER.lineFocus)
  usePlatformFade(lines, buffers, paths, interiorSpans)
  useFrame((state) => {
    if (!lines) return
    const d = cameraDistance(state)
    const t = Math.log(FADE_FAR / d) / Math.log(FADE_FAR / FADE_NEAR)
    const opacity = Math.min(Math.max(t, 0), 1)
    lines.material.opacity = opacity
    lines.visible = opacity > 0
    lines.scale.y = depthScaleY(depthFactor(d))
    writeLineDim(lines.material, levels.networkDim)
  })
  return lines && <primitive object={lines} />
}
