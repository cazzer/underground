/**
 * Where each shape runs along a station's platform tracks, and how strongly a point near them belongs to the
 * station view: the live layer lifts trains there above the interior veil, and the map track there gives way to
 * the interior's own track. Pure; no allocation in the weight functions (they run per frame).
 */
import type { ShapeId, StationId, StopId } from '../data/schema'
import type { ProfileRun } from './trackProfile'

/** Distances [d0, d1] (d0 <= d1) along a shape's track line covered by one station's platform tracks. */
export interface PlatformSpan {
  d0: number
  d1: number
  /** The platform track's stop id (the first run's, should the span union several): which deck it rides. */
  stopId?: StopId
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
      } else byShape.set(shapeId, spanOf(run.d0, run.d1, run.stopId))
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
      out.set(shapeId, have ? spanOf(Math.min(have.d0, s.d0), Math.max(have.d1, s.d1), have.stopId) : spanOf(s.d0, s.d1, s.stopId))
    }
  }
  return out
}

const spanOf = (d0: number, d1: number, stopId: StopId | undefined): PlatformSpan =>
  stopId === undefined ? { d0, d1 } : { d0, d1, stopId }

const warnedStops = new Set<string>()

/**
 * An interior's spans split by deck (`deckOf`: a track's stop id to its deck, interiorDecks.ts), deepest first, so each
 * deck's lifted trains draw between its own strokes and the next band's. Null spans give [null]; one deck or none gives
 * [spans], the same map. Otherwise one map per deck holding the same span objects; a span whose stop has no deck goes
 * to the shallowest (its trains draw over every deck's strokes, as before 2q7.28) and logs once.
 */
export function deckSpans(spans: StationSpans | null, deckOf: ReadonlyMap<StopId, number>, deckCount: number): (StationSpans | null)[] {
  if (spans === null) return [null]
  if (deckCount <= 1) return [spans]
  const out = Array.from({ length: deckCount }, () => new Map<ShapeId, PlatformSpan>())
  for (const [shapeId, s] of spans) {
    const deck = s.stopId === undefined ? undefined : deckOf.get(s.stopId)
    if (deck !== undefined && deck >= 0 && deck < deckCount) {
      out[deck]!.set(shapeId, s)
      continue
    }
    const key = s.stopId ?? shapeId
    if (!warnedStops.has(key)) {
      warnedStops.add(key)
      console.warn(`Platform trains: shape ${shapeId} (stop ${s.stopId ?? 'none'}) has no deck; drawn with the shallowest`)
    }
    out[deckCount - 1]!.set(shapeId, s)
  }
  return out
}

/** What scales a span's lifted-train weight: its drawn interior's presence (presence.ts), read per frame. */
export interface SpanPresence {
  readonly value: number
}

/** A drawn interior's platform span with that interior's presence. */
export interface ShownSpan {
  span: PlatformSpan
  presence: SpanPresence
}

/** One drawn interior's spans (a complex already unioned by `memberSpans`) and its presence. */
export interface InteriorSpans {
  spans: StationSpans | null
  presence: SpanPresence
}

/**
 * Several drawn interiors' platform spans by shape (o3r.4): one entry per interior that has a span on the shape. Never
 * unioned across interiors, so the track between two stations stays drawn and a train there stays under the veil.
 */
export type SpanSet = ReadonlyMap<ShapeId, readonly ShownSpan[]>

/** The drawn interiors' spans as one set, in order (nulls skipped; the span objects are shared, never changed); null when none has any. */
export function spanSet(perInterior: readonly InteriorSpans[]): SpanSet | null {
  let out: Map<ShapeId, ShownSpan[]> | null = null
  for (const { spans, presence } of perInterior) {
    if (!spans) continue
    out ??= new Map()
    for (const [shapeId, span] of spans) {
      const list = out.get(shapeId)
      if (list) list.push({ span, presence })
      else out.set(shapeId, [{ span, presence }])
    }
  }
  return out
}

/** One drawn interior's spans by deck (its `deckSpans`, deepest first) and its presence. */
export interface InteriorDeckSpans {
  decks: readonly (StationSpans | null)[]
  presence: SpanPresence
}

/**
 * The drawn interiors' spans by deck: deck k holds deck k of every interior, so one lifted layer per deck serves them
 * all. As long as the interior with the most decks, at least one; [null] for none.
 */
export function deckSpanSets(perInterior: readonly InteriorDeckSpans[]): (SpanSet | null)[] {
  const decks = Math.max(1, ...perInterior.map((d) => d.decks.length))
  return Array.from({ length: decks }, (_, k) => spanSet(perInterior.map((d) => ({ spans: d.decks[k] ?? null, presence: d.presence }))))
}

/** The highest of `maskSpanWeight` over the spans (0 for none). No allocation. */
export function maskWeightIn(d: number, spans: readonly ShownSpan[]): number {
  let w = 0
  for (let i = 0; i < spans.length; i++) w = Math.max(w, maskSpanWeight(d, spans[i]!.span))
  return w
}

/** The highest of `trainSpanWeight` times its interior's presence over the spans (0 for none). No allocation. */
export function trainWeightIn(d: number, spans: readonly ShownSpan[]): number {
  let w = 0
  for (let i = 0; i < spans.length; i++) w = Math.max(w, trainSpanWeight(d, spans[i]!.span) * spans[i]!.presence.value)
  return w
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
