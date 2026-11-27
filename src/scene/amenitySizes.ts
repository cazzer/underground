import { rowCentreInto, type PlateProbe } from '../lib/amenityPlacement'
import type { Ground } from '../lib/projection'
import { focusScaleFactor, markerRadiusPx, screenScale, tripMarkRadiusPx } from './cameraDistance'
import { MARKER_MIN_METERS, TRIP_MARK_HALO, TRIP_MARK_MIN_METERS } from './markerShape'

/** A mark's glyph half size on screen, px, and its floor in meters zoomed right in (StationAmenities.tsx). */
export const AMENITY_HALF_PX = 9
export const AMENITY_MIN_METERS = 3.5
/** The plate's half size as a share of the glyph's (the glyph spans -1..1). */
export const PLATE_HALF = 1.35
/** The gap past the marker and between two plates, px, held to at least AMENITY_GAP_MIN_M. */
export const AMENITY_GAP_PX = 3
export const AMENITY_GAP_MIN_M = 1

/** The marks' sizes at one camera distance, meters. */
export interface MarkSizes {
  /** The glyph's half size (it spans -1..1 in glyph units). */
  glyph: number
  /** The plate's half size. */
  plate: number
  gap: number
  /** How far the first plate keeps from a bare station's point: its marker as the focus ring draws it, or the trip
   *  mark's halo while the trip shows (either may sit on the station). */
  clear: number
}

export function newMarkSizes(): MarkSizes {
  return { glyph: 0, plate: 0, gap: 0, clear: 0 }
}

/** The sizes at camera distance `d` written into `out`, allocation-free (per frame). */
export function markSizesInto(out: MarkSizes, d: number, tripVisible: boolean): MarkSizes {
  out.glyph = screenScale(d, AMENITY_HALF_PX, AMENITY_MIN_METERS)
  out.plate = out.glyph * PLATE_HALF
  out.gap = Math.max(screenScale(d, AMENITY_GAP_PX, 0), AMENITY_GAP_MIN_M)
  if (tripVisible) out.clear = screenScale(d, tripMarkRadiusPx(d), TRIP_MARK_MIN_METERS) * TRIP_MARK_HALO
  else {
    const base = screenScale(d, markerRadiusPx(d), MARKER_MIN_METERS)
    out.clear = base * focusScaleFactor(d, base)
  }
  return out
}

/** The view distances a bearing is scored at: the landing's range, near and far end of the levels' separation. */
const PROBE_DISTANCES = [500, 1000]

/** A row of `count` plates anchored along `dir` (rowCentreInto, north-up), at each PROBE_DISTANCES: what clearBearing
 *  scores a bearing by. */
export function plateProbes(count: number, dir: Ground): PlateProbe[] {
  const s = newMarkSizes()
  const c = { x: 0, z: 0 }
  return PROBE_DISTANCES.flatMap((d) => {
    markSizesInto(s, d, false)
    return Array.from({ length: count }, (_, k): PlateProbe => {
      rowCentreInto(c, k, count, ORIGIN, dir, s.clear, s.plate, s.gap, 0)
      return { x: c.x, z: c.z, half: s.plate }
    })
  })
}

const ORIGIN = { x: 0, z: 0 }
