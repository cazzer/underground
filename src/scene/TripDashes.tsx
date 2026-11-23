import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { Color, type PerspectiveCamera } from 'three'
import type { RouteId } from '../data/schema'
import { metersPerPx } from '../lib/follow'
import type { Rgb } from '../lib/lineBuffers'
import type { Network } from '../lib/network'
import { tripDashBuffers } from '../lib/tripDashBuffers'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
import type { RideStraightSpan } from '../lib/tripSpans'
import { theme } from '../theme'
import { writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { routeColorMap, useLineLayer } from './useLineLayer'

/** Route ids a straight ride named that routes.json lacks, warned about once per session. */
const unknownRoutes = new Set<RouteId>()

function straightColor(colors: ReadonlyMap<RouteId, Rgb>): (span: RideStraightSpan) => Rgb | null {
  return (span) => {
    const own = colors.get(span.routeId) ?? null
    if (!own && !unknownRoutes.has(span.routeId)) {
      unknownRoutes.add(span.routeId)
      console.warn(`Trip route: no color for route "${span.routeId}"; its straight ride is not drawn`)
    }
    return own
  }
}

const DASH = { size: theme.tripWalkDashPx, gap: theme.tripWalkGapPx }

interface TripDashesProps {
  network: Network
  /** The route drawn (held by SubwayLines while it eases out); null with none. */
  route: TripRouteDraw | null
  /** This frame's look, written by SubwayLines at -0.25. */
  levels: EmphasisLevels
  /** The focused interior is loaded under the screen veil: draw above it (RENDER_ORDER.tripWalkOver). */
  overVeil: boolean
}

/**
 * The trip's walks between stations (theme.exitPath) and its rides found on no drawn shape (their route color, straight
 * through their stops), dashed, over the marks' halo discs and under their rings (above the veil while the focused
 * interior is loaded under look A). One plain dashed layer, every vertex at y 0 (the street, like the station points
 * the walks join, so the depth factor never moves them): the dashes stay
 * theme.tripWalkDashPx / tripWalkGapPx on screen at the view's target, since the dash scale is written per frame as
 * pixels per meter there. As wide as the ride legs, dimmed with them in the list view, faded in by opacity. Takes no
 * picks (ScenePicker picks stations and trains only).
 */
export function TripDashes({ network, route, levels, overVeil }: TripDashesProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const walks = route?.walks
  const straights = route?.straights
  const buffers = useMemo(() => {
    if (!walks || !straights) return null
    const pink = new Color(theme.exitPath)
    return tripDashBuffers(walks, straights, [pink.r, pink.g, pink.b], straightColor(routeColorMap(network, theme.routeLineMix)))
  }, [network, walks, straights])
  const lines = useLineLayer(buffers, RENDER_ORDER.tripWalk, theme.tripLineWidth, DASH, { dimmable: true })
  useFrame((state) => {
    if (!lines) return
    lines.renderOrder = overVeil ? RENDER_ORDER.tripWalkOver : RENDER_ORDER.tripWalk
    lines.visible = levels.tripVisible
    if (!levels.tripVisible) return
    const m = lines.material
    m.linewidth = levels.tripWidthPx
    m.dashScale = 1 / metersPerPx(cameraDistance(state), camera.fov, state.size.height)
    m.opacity = levels.tripOpacity
    writeLineDim(m, levels.tripDim)
  })
  return lines && <primitive object={lines} />
}
