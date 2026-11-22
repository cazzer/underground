/**
 * Where each shape runs along a station's platform tracks, and how strongly a point near them belongs to the
 * station view: the live layer lifts trains there above the interior veil, and the map track there gives way to
 * the interior's own track. Pure; no allocation in the weight functions (they run per frame).
 */
import type { ShapeId, StationId } from '../data/schema'
import type { ProfileRun } from './trackProfile'

/** Distances [d0, d1] (d0 <= d1) along a shape's track line covered by one station's platform tracks. */
export interface PlatformSpan {
  d0: number
  d1: number
}

export type StationSpans = ReadonlyMap<ShapeId, PlatformSpan>

/** A train car's weight falls from 1 at a platform end to 0 this far beyond it. */
export const TRAIN_RAMP_M = 40
/** The map track gives way to the interior's track over this much of each platform end, inside it. */
export const MASK_INSET_M = 10

/**
 * Spans per station and shape from the runs each shape's profile kept (buildTrackProfile's `kept`): the union of
 * a shape's runs at one station, should it ride more than one of its tracks. Runs without a station are skipped.
 * The union covers any gap between two such runs too, so the mask would erase the map track there and trains would
 * stay lifted across it. No authored station has that today (a shape rides one track per station); a multi-level
 * interior where one shape rides two separated tracks would need per-run spans instead.
 */
export function platformSpans(kept: Iterable<readonly [ShapeId, readonly ProfileRun[]]>): Map<StationId, Map<ShapeId, PlatformSpan>> {
  const out = new Map<StationId, Map<ShapeId, PlatformSpan>>()
  for (const [shapeId, runs] of kept) {
    for (const run of runs) {
      if (run.stationId === undefined) continue
      let byShape = out.get(run.stationId)
      if (!byShape) out.set(run.stationId, (byShape = new Map()))
      const span = byShape.get(shapeId)
      if (span) {
        span.d0 = Math.min(span.d0, run.d0)
        span.d1 = Math.max(span.d1, run.d1)
      } else byShape.set(shapeId, { d0: run.d0, d1: run.d1 })
    }
  }
  return out
}

/**
 * The platform spans an interior covers, for its members `ids` (a complex's stations, else one): a single id gives
 * its own map (same identity) or null; several give a new map holding each shape's union over the members, so the
 * track fades and the cars lift along every member's platforms. A shape that rides two members gets one span over
 * both, any gap between them included (as `platformSpans` does for one station). Null when none has spans.
 */
export function memberSpans(all: ReadonlyMap<StationId, StationSpans>, ids: readonly StationId[]): StationSpans | null {
  if (ids.length === 1) return all.get(ids[0]!) ?? null
  let out: Map<ShapeId, PlatformSpan> | null = null
  for (const id of ids) {
    const spans = all.get(id)
    if (!spans) continue
    out ??= new Map()
    for (const [shapeId, s] of spans) {
      const have = out.get(shapeId)
      out.set(shapeId, have ? { d0: Math.min(have.d0, s.d0), d1: Math.max(have.d1, s.d1) } : { d0: s.d0, d1: s.d1 })
    }
  }
  return out
}

/**
 * 1 on [start, end], easing (smoothstep) to 0 at `rampM` outside it. With start > end (a span shorter than two
 * insets) the peak, midway, stays below 1. Continuous in d; rampM must be positive.
 */
export function rampWeight(d: number, start: number, end: number, rampM: number): number {
  const outside = Math.max(start - d, d - end, 0)
  if (outside >= rampM) return 0
  const t = 1 - outside / rampM
  return t * t * (3 - 2 * t)
}

/** How much of a train car at distance d is lifted above the veil: 1 along the platform, 0 past the ramp. */
export function trainSpanWeight(d: number, span: PlatformSpan): number {
  return rampWeight(d, span.d0, span.d1, TRAIN_RAMP_M)
}

/** How much of the map track at d gives way to the interior's: 1 inside the platform, 0 at its ends and beyond. */
export function maskSpanWeight(d: number, span: PlatformSpan): number {
  return rampWeight(d, span.d0 + MASK_INSET_M, span.d1 - MASK_INSET_M, MASK_INSET_M)
}

/** Share of the veil's dimming a lifted car keeps on the platform (weight 1), so it sits just behind the interior (pah.7.1 C). */
export const PLATFORM_RESIDUAL_TINT = 0.2

/**
 * How far a lifted car mixes toward the background, so it matches the veil it is drawn above where it leaves the
 * span (weight 0: the veil's opacity at this reveal) and keeps a faint `PLATFORM_RESIDUAL_TINT` of it on the
 * platform (weight 1).
 */
export function veilTint(reveal: number, weight: number, veilOpacity: number): number {
  return veilOpacity * reveal * (1 - (1 - PLATFORM_RESIDUAL_TINT) * weight)
}
