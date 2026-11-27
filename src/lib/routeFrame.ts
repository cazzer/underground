/**
 * Framing the whole selected trip route (2q7.45.5). Pure: the ground points a route draws, and the top-down camera that
 * fits them in the free rect the HUD and the trip panel leave. The distance is whatever the route needs, floored by the
 * caller (EXIT_DISTANCE keeps the view exactly top-down, so this fit is exact).
 */
import type { StopId } from '../data/schema'
import { EXIT_DISTANCE } from './focusMachine'
import type { Viewport } from './framing'
import type { ScreenRect } from './interiorCamera'
import type { Station } from './network'
import type { Ground } from './projection'
import type { TripLeg } from './route/plan'
import { spanPoints, type SpanShape, type TripSpan } from './tripSpans'

/** Never closer than just past EXIT_DISTANCE: the view is exactly top-down, and focus drops (the focus machine's test is strict). */
export const ROUTE_MIN_DISTANCE = EXIT_DISTANCE * (1 + 1e-3)

/** Space kept clear between the route and the free rect's edges, CSS px. */
export const ROUTE_PAD_PX = 32

/** The stations the legs board, alight and walk between, in leg order (a stop no station lists throws). */
export function legStationPoints(legs: readonly TripLeg[], stopStations: ReadonlyMap<StopId, Station>): Ground[] {
  const stops = legs.flatMap((l) => (l.kind === 'ride' ? [l.boardStop, l.alightStop] : [l.fromStop, l.toStop]))
  return stops.map((s) => {
    const station = stopStations.get(s)
    if (!station) throw new Error(`Trip leg names stop "${s}", which no station lists`)
    return { x: station.pos.x, z: station.pos.z }
  })
}

/** Every ground point the route draws: each ride's stretch of its shape, a straight ride's points and a walk's street path (else its ends), and `stations`. */
export function routeFramePoints(spans: readonly TripSpan[], shapeById: ReadonlyMap<string, SpanShape>, stations: readonly Ground[]): Ground[] {
  const out: Ground[] = []
  for (const span of spans) {
    if (span.kind === 'ride') {
      const shape = shapeById.get(span.shapeId)
      if (!shape) throw new Error(`Trip span rides shape "${span.shapeId}", which the map does not draw`)
      out.push(...spanPoints(shape, span.d0, span.d1))
    } else if (span.kind === 'straight') out.push(...span.points)
    else if (span.path) out.push(...span.path)
    else out.push(span.from, span.to)
  }
  out.push(...stations)
  return out
}

/**
 * Top-down camera (distance and the ground point at the viewport's center) that puts every point inside `free` less
 * `padPx` on each side, centered in it, at the smallest distance in [minDistance, maxDistance] that does. A route
 * wider than the clamp allows is centered and overflows. Exact for a camera looking straight down (the tilt is 0 from
 * 1450 m). Screen right is +x and down is +z; the free rect's center sits `free - viewport` px from the view center.
 */
export function frameTopDown(
  points: readonly Ground[],
  viewport: Viewport,
  free: ScreenRect,
  fovDeg: number,
  minDistance: number,
  maxDistance: number,
  padPx: number = ROUTE_PAD_PX,
): { distance: number; target: Ground } {
  if (points.length === 0) throw new Error('Route frame needs at least one point')
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  const tan = Math.tan((fovDeg * Math.PI) / 360)
  const freeW = Math.max(free.right - free.left - 2 * padPx, 1)
  const freeH = Math.max(free.bottom - free.top - 2 * padPx, 1)
  const fitted = Math.max((maxX - minX) / freeW, (maxZ - minZ) / freeH) * (viewport.height / (2 * tan))
  const distance = Math.min(Math.max(fitted, minDistance), maxDistance)
  const metersPerPx = (2 * distance * tan) / viewport.height
  const dx = ((free.left + free.right) / 2 - viewport.width / 2) * metersPerPx
  const dz = ((free.top + free.bottom) / 2 - viewport.height / 2) * metersPerPx
  return { distance, target: { x: (minX + maxX) / 2 - dx, z: (minZ + maxZ) / 2 - dz } }
}
