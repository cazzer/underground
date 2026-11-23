import { useFrame } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import type { RouteId } from '../data/schema'
import type { Rgb } from '../lib/lineBuffers'
import type { Network, ShapePath } from '../lib/network'
import type { StationSpans } from '../lib/platformSpan'
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
    if (!unknownRoutes.has(ride.routeId)) {
      unknownRoutes.add(ride.routeId)
      console.warn(`Trip route: no color for route "${ride.routeId}"; drawn in its shape's route color`)
    }
    return colors.get(path.routeId) ?? null
  }
}

interface TripLinesProps {
  network: Network
  /** The shapes SubwayLines draws (banded once the bands arrive); `route`'s spans are found on them. */
  paths: readonly ShapePath[]
  /** The selected journey's ride legs; null with none (the last one stays drawn while it eases out). */
  route: TripRouteDraw | null
  /** This frame's look, written by SubwayLines at -0.25. */
  levels: EmphasisLevels
  /** Its platform tracks fade out with the interior, as SubwayLines' do. */
  interiorSpans: StationSpans | null
}

/**
 * The trip's ride legs over the dimmed network: the same segments, heights and band inputs as the map's line, so the
 * trains ride it, cut exactly at the stops by each segment's window (tripLineBuffers.ts). In route colors under
 * theme.routeLineMix whatever ?lines= draws, wider and full once a journey is opened, faint in the list view.
 */
export function TripLines({ network, paths, route, levels, interiorSpans }: TripLinesProps) {
  // The last route drawn, so closing the panel eases it out instead of dropping it.
  const [held, setHeld] = useState(route)
  if (route !== null && route !== held) setHeld(route)
  const buffers = useMemo(
    () => (held ? tripLineBuffers(paths, held.rides, rideColor(routeColorMap(network, theme.routeLineMix))) : null),
    [network, paths, held],
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
