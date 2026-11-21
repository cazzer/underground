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
import type { StationId } from '../data/schema'
import { useFocus } from '../lib/focus'
import type { Network, ShapePath } from '../lib/network'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { routeLineBuffers, useLineLayer } from './useLineLayer'
import { usePlatformFade } from './usePlatformFade'

interface LayerProps {
  network: Network
  /** The shapes SubwayLines draws (banded once the bands arrive). */
  paths: readonly ShapePath[]
  /** Its platform tracks fade out with the interior, as SubwayLines' do. */
  interiorStationId: StationId | null
}

/** Option A: the focused station's routes, redrawn in route colors over the mono network. */
export function LineHighlight({ network, paths, interiorStationId }: LayerProps) {
  const { focusedId } = useFocus()
  const buffers = useMemo(() => {
    const station = focusedId ? network.stationById.get(focusedId) : undefined
    if (!station) return null
    const routes = new Set(station.routeIds)
    return routeLineBuffers(network, paths.filter((s) => routes.has(s.routeId)), theme.routeLineMix)
  }, [network, paths, focusedId])
  const lines = useLineLayer(buffers, RENDER_ORDER.lineFocus)
  usePlatformFade(lines, buffers, paths, network, interiorStationId)
  return lines && <primitive object={lines} />
}

/** Option C: route colors fade in over the mono network between these camera distances. */
const FADE_FAR = 8_000
const FADE_NEAR = 3_000

export function LineFade({ network, paths, interiorStationId }: LayerProps) {
  const buffers = useMemo(() => routeLineBuffers(network, paths, theme.routeLineMix), [network, paths])
  const lines = useLineLayer(buffers, RENDER_ORDER.lineFocus)
  usePlatformFade(lines, buffers, paths, network, interiorStationId)
  useFrame((state) => {
    if (!lines) return
    const d = cameraDistance(state)
    const t = Math.log(FADE_FAR / d) / Math.log(FADE_FAR / FADE_NEAR)
    const opacity = Math.min(Math.max(t, 0), 1)
    lines.material.opacity = opacity
    lines.visible = opacity > 0
  })
  return lines && <primitive object={lines} />
}
