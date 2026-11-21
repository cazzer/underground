/**
 * Where a shape's drawn line needs vertices beyond its own: the vertical profile's ramps, the band tapers and the
 * platform fade's ramps, so a straight line drawn between vertices follows each eased change. Pure.
 */
import type { ShapeId, StationId } from '../data/schema'
import type { ShapeBands } from './corridors'
import { maskBreaks } from './platformMask'
import type { PlatformSpan } from './platformSpan'
import { profileBreaks, type TrackProfile } from './trackProfile'

/** Band tapers get a vertex this often, so the eased slot change draws as a curve, not a kink. */
export const BAND_STEP_M = 30
/** Ramps get one every this far (as the realtime geometry once resampled them). */
const RAMP_STEP_M = 10
/** Taper breaks closer than this to the previous one are dropped: the slot and half-width tapers mostly coincide. */
const MIN_BREAK_GAP_M = 5

/** Sorted break distances for `resampleAt`: ramps, tapers, and the fade ramps of each station span of shape `id`. */
export function lineBreaks(
  profile: TrackProfile,
  bands: ShapeBands,
  spans: ReadonlyMap<StationId, ReadonlyMap<ShapeId, PlatformSpan>>,
  id: ShapeId,
): number[] {
  const out = profileBreaks(profile, RAMP_STEP_M)
  for (const byShape of spans.values()) {
    const span = byShape.get(id)
    if (span) out.push(...maskBreaks(span))
  }
  const tapers = [...profileBreaks(bands.slot, BAND_STEP_M), ...profileBreaks(bands.half, BAND_STEP_M)].sort((a, b) => a - b)
  let last = -Infinity
  for (const d of tapers) {
    if (d - last < MIN_BREAK_GAP_M) continue
    out.push(d)
    last = d
  }
  out.sort((a, b) => a - b)
  return out.filter((d, i) => i === 0 || d > out[i - 1]!)
}
