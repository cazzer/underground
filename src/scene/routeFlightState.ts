/** What the route flight and its reframes share (useRouteFlight.ts, useRouteReframe.ts). */
import { Vector3 } from 'three'
import { interiorFreeRect } from '../lib/interiorCamera'
import type { CollapsePending } from '../lib/collapseReframe'
import type { PointLanding } from '../lib/pointResnap'
import type { Ground } from '../lib/projection'
import type { RouteToken } from '../lib/routeFrameRule'
import { frameTopDown, ROUTE_MIN_DISTANCE } from '../lib/routeFrame'
import type { Destination, Flight } from './cameraFlight'
import type { FlightLayout } from './useStationFlights'

/** The flight this feature started last, with what it framed; replaced by each reframe, dropped when another flight lands. */
export interface RouteFlight {
  flight: Flight
  /** The route it framed: a reframe only ever frames it again while it is still the route drawn. */
  token: RouteToken
  points: readonly Ground[]
  reduced: boolean
  landing: PointLanding
  /** performance.now() at its landing, ms; null while it flies. */
  landedAt: number | null
  /** The viewport and the free rect's bottom (px) it framed in. */
  width: number
  height: number
  bottom: number
  /** The post-landing window (routeMoveArms) is still open: not used, and no press closed it. */
  windowOpen: boolean
  /** The reduced-motion re-snap has run. */
  resnapped: boolean
  /** A reframe waiting for the panel to settle. */
  pending: CollapsePending | null
}

export function routeDestination(points: readonly Ground[], l: FlightLayout, fovDeg: number): Destination {
  const free = interiorFreeRect(l.size, l.insets, l.panel)
  const { distance, target } = frameTopDown(points, l.size, free, fovDeg, ROUTE_MIN_DISTANCE, l.maxDistance)
  return { stationId: null, target: new Vector3(target.x, 0, target.z), distance, azimuth: 0, follows: false }
}

export const freeBottom = (l: FlightLayout): number => interiorFreeRect(l.size, l.insets, l.panel).bottom

export const landingOf = (dest: Destination, at: number): PointLanding => ({ at, target: { x: dest.target.x, z: dest.target.z }, distance: dest.distance })
