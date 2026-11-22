/** Where a geolocation fix lands on the map, and what the HUD should offer for it. Pure; no coordinates leave memory. */
import type { Bounds, Station } from './network'
import { toGround, type Ground } from './projection'

/** A fix this close to a station is "near": the camera flies to it. */
export const NEAR_STATION_M = 2000
/** How far past the network bounds still counts as the covered area (else "outside"). */
export const BOUNDS_PAD_M = 2000
/** An accuracy radius above this is called approximate in the message. */
export const APPROXIMATE_M = 300
/** The flight's framing radius never goes below this. */
export const MIN_VIEW_RADIUS_M = 250
/** The nearest station only widens the framing up to this distance. */
export const NEAREST_IN_VIEW_CAP_M = 800
/** A far fix's framing circle (fix and station) is widened by this so both sit well inside the screen. */
export const FAR_VIEW_PADDING = 1.25

export interface Fix {
  lat: number
  lon: number
  accuracyM: number
}

export interface NearestStation {
  id: string
  name: string
  pos: Ground
  distanceM: number
}

/** A fix inside the covered area: the marker, and the circle (center and radius) the camera frames. */
interface Marked {
  ground: Ground
  accuracyM: number
  approximate: boolean
  nearest: NearestStation
  viewCenter: Ground
  viewRadiusM: number
}

export type Placement =
  /** Within NEAR_STATION_M of a station: frames the fix. */
  | ({ kind: 'near' } & Marked)
  /** Inside the network but farther: frames the fix and its nearest station together. */
  | ({ kind: 'far' } & Marked)
  | { kind: 'outside'; nearest: NearestStation }

export type LocateFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

/** `previous` is the last good placement, kept (and drawn) while re-locating or after a failed attempt. */
export type LocateState =
  | { status: 'idle' }
  | { status: 'locating'; previous: Placement | null }
  | { status: 'located'; placement: Placement }
  | { status: 'failed'; reason: LocateFailure; previous: Placement | null }

/** The placement to draw: the current one, or the last good one during a re-locate or after a failure. */
export function lastPlacement(state: LocateState): Placement | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'located':
      return state.placement
    default:
      return state.previous
  }
}

/** A placement that gets a map marker (not "outside"). */
export type MarkedPlacement = Extract<Placement, { kind: 'near' | 'far' }>

/** The placement that gets a map marker, if any. */
export function markedPlacement(state: LocateState): MarkedPlacement | null {
  const p = lastPlacement(state)
  return p && p.kind !== 'outside' ? p : null
}

export function startLocating(state: LocateState): LocateState {
  return { status: 'locating', previous: lastPlacement(state) }
}

export function failLocating(state: LocateState, reason: LocateFailure): LocateState {
  return { status: 'failed', reason, previous: lastPlacement(state) }
}

/** The x button: clears a shown location, cancels a pending request, or dismisses a failure message (keeping the last good fix). */
export function dismissLocate(state: LocateState): LocateState {
  if (state.status === 'locating' || state.status === 'failed') {
    return state.previous ? { status: 'located', placement: state.previous } : { status: 'idle' }
  }
  return { status: 'idle' }
}

/** A validated fix, or null when the browser reported something unusable. */
export function toFix(lat: number, lon: number, accuracyM: number): Fix | null {
  const ok =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Number.isFinite(accuracyM) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    accuracyM >= 0
  return ok ? { lat, lon, accuracyM } : null
}

/** Closest station to `ground` by straight-line distance; null for an empty network. */
export function nearestStation(ground: Ground, stations: readonly Station[]): NearestStation | null {
  let best: NearestStation | null = null
  for (const s of stations) {
    const d = Math.hypot(s.pos.x - ground.x, s.pos.z - ground.z)
    if (!best || d < best.distanceM) best = { id: s.id, name: s.name, pos: s.pos, distanceM: d }
  }
  return best
}

function insidePadded(g: Ground, b: Bounds): boolean {
  return (
    g.x >= b.minX - BOUNDS_PAD_M && g.x <= b.maxX + BOUNDS_PAD_M && g.z >= b.minZ - BOUNDS_PAD_M && g.z <= b.maxZ + BOUNDS_PAD_M
  )
}

/**
 * Near a station: frame the fix. Inside the (padded) network but far from any station: frame the fix and
 * its nearest station together. Outside the network: no marker, just the nearest station. Null for an
 * empty network.
 */
export function placeFix(fix: Fix, stations: readonly Station[], bounds: Bounds): Placement | null {
  const ground = toGround({ lat: fix.lat, lon: fix.lon })
  const nearest = nearestStation(ground, stations)
  if (!nearest) return null
  const approximate = fix.accuracyM > APPROXIMATE_M
  if (nearest.distanceM <= NEAR_STATION_M) {
    const viewRadiusM = Math.max(fix.accuracyM, Math.min(nearest.distanceM, NEAREST_IN_VIEW_CAP_M), MIN_VIEW_RADIUS_M)
    return { kind: 'near', ground, accuracyM: fix.accuracyM, approximate, nearest, viewCenter: ground, viewRadiusM }
  }
  if (insidePadded(ground, bounds)) {
    const viewCenter = { x: (ground.x + nearest.pos.x) / 2, z: (ground.z + nearest.pos.z) / 2 }
    const viewRadiusM = Math.max((nearest.distanceM / 2 + fix.accuracyM) * FAR_VIEW_PADDING, MIN_VIEW_RADIUS_M)
    return { kind: 'far', ground, accuracyM: fix.accuracyM, approximate, nearest, viewCenter, viewRadiusM }
  }
  return { kind: 'outside', nearest }
}

/** GeolocationPositionError.code to a failure; anything unexpected reads as unavailable. */
export function failureFromCode(code: number): LocateFailure {
  if (code === 1) return 'denied'
  if (code === 3) return 'timeout'
  return 'unavailable'
}
