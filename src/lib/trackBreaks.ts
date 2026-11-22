/**
 * Where a shape's drawn line needs vertices beyond its own: the vertical profile's ramps, the band tapers and the
 * platform fade's ramps, so a straight line drawn between vertices follows each eased change. Pure.
 */
import type { ShapeId, StationId } from '../data/schema'
import type { ShapeBands } from './corridors'
import { maskBreaks } from './platformMask'
import type { PlatformSpan } from './platformSpan'
import { rampBreaks } from './rampSampling'
import { profileAt, profileBreaks, type TrackProfile } from './trackProfile'

/** Band tapers get a vertex this often, so the eased slot change draws as a curve, not a kink. */
export const BAND_STEP_M = 30
/** Taper breaks closer than this to the previous one are dropped: the slot and half-width tapers mostly coincide. */
const MIN_BREAK_GAP_M = 5
/**
 * A taper break inside an ease is kept only once the slot or half-width has moved this much since the last one
 * (the ease's flat ends need fewer vertices than its steep middle; the chord strays under 0.05 slot).
 */
const MIN_TAPER_STEP = 0.25
/**
 * A 0.5 slot ease is exactly MIN_TAPER_STEP from its start at its middle. A variant's knots mapped from its primary's
 * (corridorShare.ts) carry float noise, which must not decide whether the variant keeps the break the primary keeps:
 * a step this close to MIN_TAPER_STEP counts as reaching it. Small enough that no primary's breaks change
 * (trackBreaks.data.test.ts); 1e-3 added breaks to ten.
 */
export const STEP_EPS = 1e-5

/**
 * Sorted break distances for `resampleAt`: ramps, tapers, and the fade ramps of each station span of shape `id`.
 * `stepEps` is STEP_EPS but for the data test that compares with none.
 */
export function lineBreaks(
  profile: TrackProfile,
  bands: ShapeBands,
  spans: ReadonlyMap<StationId, ReadonlyMap<ShapeId, PlatformSpan>>,
  id: ShapeId,
  stepEps = STEP_EPS,
): number[] {
  const out = rampBreaks(profile)
  for (const byShape of spans.values()) {
    const span = byShape.get(id)
    if (span) out.push(...maskBreaks(span))
  }
  const tapers = [...profileBreaks(bands.slot, BAND_STEP_M), ...profileBreaks(bands.half, BAND_STEP_M)].sort((a, b) => a - b)
  // Knots (an ease's two ends) are always kept, so the flat stretches stay flat.
  const knots = new Set([...bands.slot.d, ...bands.half.d])
  let last = -Infinity
  let slot = NaN
  let half = NaN
  for (const d of tapers) {
    if (d - last < MIN_BREAK_GAP_M) continue
    const s = profileAt(bands.slot, d)
    const h = profileAt(bands.half, d)
    if (!knots.has(d) && Math.abs(s - slot) < MIN_TAPER_STEP - stepEps && Math.abs(h - half) < MIN_TAPER_STEP - stepEps) continue
    out.push(d)
    last = d
    slot = s
    half = h
  }
  out.sort((a, b) => a - b)
  return out.filter((d, i) => i === 0 || d > out[i - 1]!)
}
