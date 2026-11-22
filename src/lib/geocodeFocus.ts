/**
 * What an address search may say about where the user is looking (pure). The bias is the focused station, else the
 * camera target, rounded to 2 decimals (about 1 km). The user's location fix never goes into a request: it is only
 * read here, to leave out a candidate that sits near it, since the view there is a place the fix put it.
 */
import { NYC_BBOX } from '../data/realtime'
import type { MarkedPlacement } from './locate'
import { excludedByLocate, type LocateMemory } from './locateMemory'
import { toLatLon, type Ground, type LatLon } from './projection'

/** A candidate this close to a shown fix is dropped (a fix's own framing radius may make this wider). */
export const FIX_GUARD_M = 2000

export interface GeocodeFocusInput {
  /** The focused station's point (user picked, or auto-focused). */
  station: Ground | null
  /** Its id: the station nearest a location fix is excluded however the user got to it. */
  stationId?: string | null
  /** The camera target; null before the scene mounts. */
  view: Ground | null
  /** The marked fix: only to exclude, never sent. */
  fix: MarkedPlacement | null
  /** Where the last location flight put the view (`locateMemoryFor`): kept through later flights and a cleared fix. */
  locate: LocateMemory | null
}

const distance = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)
const round2 = (n: number) => Math.round(n * 100) / 100

/** The `focus` a request may carry, or null (no bias): outside the city, or near where the user's fix put the view. */
export function geocodeFocus({ station, stationId = null, view, fix, locate }: GeocodeFocusInput): LatLon | null {
  const candidate = station ?? view
  if (!candidate) return null
  if (fix && distance(candidate, fix.ground) <= Math.max(FIX_GUARD_M, 2 * fix.viewRadiusM)) return null
  if (excludedByLocate(locate, candidate, station ? stationId : null)) return null
  const at = toLatLon(candidate)
  const rounded = { lat: round2(at.lat), lon: round2(at.lon) }
  const [minLon, minLat, maxLon, maxLat] = NYC_BBOX
  const inside = rounded.lon >= minLon && rounded.lon <= maxLon && rounded.lat >= minLat && rounded.lat <= maxLat
  return inside ? rounded : null
}

/** The query-string form the Worker accepts: two decimals each. */
export function focusParam(focus: LatLon): string {
  return `${focus.lat.toFixed(2)},${focus.lon.toFixed(2)}`
}
