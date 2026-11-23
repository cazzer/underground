import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { Color, type PerspectiveCamera } from 'three'
import type { RouteId } from '../data/schema'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { metersPerPx } from '../lib/follow'
import { interiorOpacity } from '../lib/interiorReveal'
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
  /** The focused interior is loaded under the screen veil: the walks draw above it while it reveals (RENDER_ORDER.tripWalkOver). */
  overVeil: boolean
}

/**
 * The trip's walks between stations (theme.exitPath), dashed over the marks' halo discs and under their rings (above the
 * veil while the focused interior is loaded under look A and revealing), and its rides found on no drawn shape (their
 * route color, straight through their stops), dashed over the ride legs and under the station markers. Two plain dashed
 * layers, every vertex at y 0 (the street, like the station points the walks join, so the depth factor never moves
 * them): the dashes stay
 * theme.tripWalkDashPx / tripWalkGapPx on screen at the view's target, since the dash scale is written per frame as
 * pixels per meter there. As wide as the ride legs, dimmed with them in the list view, faded in by opacity. Takes no
 * picks (ScenePicker picks stations and trains only).
 */
export function TripDashes({ network, route, levels, overVeil }: TripDashesProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const walks = route?.walks
  const straights = route?.straights
  const walkBuffers = useMemo(() => {
    if (!walks) return null
    const pink = new Color(theme.exitPath)
    return tripDashBuffers(walks, [], [pink.r, pink.g, pink.b], () => null)
  }, [walks])
  const straightBuffers = useMemo(
    () => (straights ? tripDashBuffers([], straights, [0, 0, 0], straightColor(routeColorMap(network, theme.routeLineMix))) : null),
    [network, straights],
  )
  const walkLines = useLineLayer(walkBuffers, RENDER_ORDER.tripWalk, theme.tripLineWidth, DASH, { dimmable: true })
  const straightLines = useLineLayer(straightBuffers, RENDER_ORDER.tripStraight, theme.tripLineWidth, DASH, { dimmable: true })
  useFrame((state) => {
    const distance = cameraDistance(state)
    const dashScale = 1 / metersPerPx(distance, camera.fov, state.size.height)
    if (walkLines) {
      walkLines.renderOrder = overVeil && interiorOpacity(distance) > 0 ? RENDER_ORDER.tripWalkOver : RENDER_ORDER.tripWalk
      writeDashLook(walkLines, levels, dashScale)
    }
    if (straightLines) writeDashLook(straightLines, levels, dashScale)
  })
  return (
    <>
      {walkLines && <primitive object={walkLines} />}
      {straightLines && <primitive object={straightLines} />}
    </>
  )
}

/** One dashed layer's per-frame look: shown with the trip, its width, dash scale, opacity and faint dim. No allocation. */
function writeDashLook(lines: LineSegments2, levels: EmphasisLevels, dashScale: number): void {
  lines.visible = levels.tripVisible
  if (!levels.tripVisible) return
  const m = lines.material
  m.linewidth = levels.tripWidthPx
  m.dashScale = dashScale
  m.opacity = levels.tripOpacity
  writeLineDim(m, levels.tripDim)
}
