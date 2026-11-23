import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import type { RouteId } from '../data/schema'
import type { Rgb } from '../lib/lineBuffers'
import type { Network, ShapePath } from '../lib/network'
import type { SpanSet } from '../lib/platformSpan'
import { depthFactor, depthScaleY } from '../lib/tilt'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { tripLineBuffers, type TripRouteDraw } from '../lib/tripLineBuffers'
import type { RideShapeSpan } from '../lib/tripSpans'
import { theme } from '../theme'
import { writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { routeColorMap, useLineLayer } from './useLineLayer'
import { usePlatformFade } from './usePlatformFade'

/** Route ids a ride named that routes.json lacks, warned about once per session. */
const unknownRoutes = new Set<RouteId>()

/**
 * A ride's color: its own route's, so a leg found on another route's track still reads as its line; for a route
 * routes.json lacks (a feed-only reroute), warned once, the drawn shape's route's; else none, and the ride isn't drawn.
 */
function rideColor(colors: ReadonlyMap<RouteId, Rgb>): (ride: RideShapeSpan, path: ShapePath) => Rgb | null {
  return (ride, path) => {
    const own = colors.get(ride.routeId)
    if (own) return own
    const fallback = colors.get(path.routeId) ?? null
    if (!unknownRoutes.has(ride.routeId)) {
      unknownRoutes.add(ride.routeId)
      const then = fallback ? `drawn in its shape's route ${path.routeId} color` : 'not drawn'
      console.warn(`Trip route: no color for route "${ride.routeId}"; ${then}`)
    }
    return fallback
  }
}

interface TripLinesProps {
  network: Network
  /** The shapes SubwayLines draws (banded once the bands arrive); `route`'s spans are found on them. */
  paths: readonly ShapePath[]
  /** The selected journey's ride legs, held by SubwayLines while they ease out; null with none. */
  route: TripRouteDraw | null
  /** This frame's look, written by SubwayLines at -0.25. */
  levels: EmphasisLevels
  /** Its platform tracks fade out with the interior, as SubwayLines' do. */
  interiorSpans: SpanSet | null
}

/**
 * The trip's ride legs over the dimmed network: the same segments, heights and band inputs as the map's line, so the
 * trains ride it, cut exactly at the stops by each segment's window (tripLineBuffers.ts). In route colors under
 * theme.routeLineMix whatever ?lines= draws, wider and full once a journey is opened, faint in the list view.
 */
export function TripLines({ network, paths, route, levels, interiorSpans }: TripLinesProps) {
  const rides = route?.rides
  const buffers = useMemo(
    () => (rides ? tripLineBuffers(paths, rides, rideColor(routeColorMap(network, theme.routeLineMix))) : null),
    [network, paths, rides],
  )
  // The width is written per frame, never rebuilt: the base width here.
  const lines = useLineLayer(buffers, RENDER_ORDER.tripLine)
  usePlatformFade(lines, buffers, paths, interiorSpans)
  useFrame((state) => {
    if (!lines) return
    lines.visible = levels.tripVisible
    if (!levels.tripVisible) return
    lines.scale.y = depthScaleY(depthFactor(cameraDistance(state)))
    lines.material.linewidth = levels.tripWidthPx
    writeLineDim(lines.material, levels.tripDim)
  })
  return lines && <primitive object={lines} />
}
