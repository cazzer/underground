/**
 * Station interior (public/data/stations/<id>.json) to LineSegments2 buffers.
 * `.ts` import paths: scripts/lib/stationOutputs.test.ts (nodenext) loads this file.
 */
import type { Connector, LocalPoint, StationInterior } from '../data/stationSchema.ts'
import { spreadBanks } from './escalatorBanks.ts'
import { bandCutYs, strokeBandOf } from './interiorDecks.ts'
import { stationAxis } from './interiorAxis.ts'
import { interiorBounds } from './interiorFraming.ts'
import {
  drawElevatorShaft,
  drawElevatorStop,
  drawEscalator,
  drawRamp,
  drawWalkway,
  type ConnectorContext,
} from './interiorConnectors.ts'
import { SegmentWriter, SplitAtY, type Buffers, type InteriorRole, type Rgb, type SegmentSink } from './interiorSegments.ts'

export type { Buffers, InteriorRole, Rgb } from './interiorSegments.ts'
export { trainRoofY } from './interiorDecks.ts'

/** Estimated drop from the platform edge to the rail head, meters: where the interior draws its tracks. */
export const RAIL_DROP_M = 1.1

export interface InteriorBufferOptions {
  /** Vertical exaggeration; x/z are never scaled. */
  yScale: number
  /** Real (unscaled) rise per drawn stair step, meters. */
  stepRise: number
  /** Estimated drop from the platform edge to the rail head, meters. */
  railDrop: number
  /** Side of the square drawn at each street entrance, meters. */
  entranceSize: number
  /**
   * Street reference: a vertical guide from every slab (mezzanine) vertex up to the street, and
   * the slab outline repeated at street level joining their tops. Platforms get none.
   */
  guides: boolean
  /**
   * Generated interiors: mark platform and slab outlines, the slab guides and their street-level copy, and a
   * walkway's sides, as dashed in `distances` (tracks stay solid). Positions and colors are the same either way.
   * A slab with `approximate` always dashes its outline and guides, with or without this (platforms stay solid), and a
   * walkway between two such slabs dashes its sides.
   */
  dashStructure?: boolean
  /**
   * The platform decks (`interiorDecks`: level indices, deepest first). Each level draws in its stroke band
   * (`strokeBandOf`): band j is deck j and the levels between it and the deck below, drawn under deck j's lifted
   * trains and over deck j - 1's. A stair, escalator or elevator shaft from one band up to a later one is cut at each
   * lower deck's train roof (`bandCutYs`): the part under a roof stays with that deck's band, so a car in front of a
   * stair foot hides it, and the rest goes up a band. Default none: everything in band 0.
   */
  decks?: readonly number[]
  /**
   * Machines (elevators, escalators) that are out of service, by connector id: drawn in the `outage` role with an
   * X. Default none.
   */
  outOfService?: (connectorId: string) => boolean
  /** Linear RGB for a role on the level at `levelIndex`, an index into `interior.levels` (highest first, so the
   *  street is 0 below ground and the last level at an elevated station). */
  colorOf: (role: InteriorRole, levelIndex: number) => Rgb
}

/** One stroke band's two layers. */
export interface BandBuffers {
  strong: Buffers
  fine: Buffers
}

/**
 * The stroke bands: band 0 (`strong`, `fine`), the bands between decks (`mid`, bands 1 to decks - 1; empty with one
 * deck or none) and the top band (`overStrong`, `overFine`: the levels above the shallowest deck; empty with no deck).
 */
export interface InteriorLayers {
  strong: Buffers
  fine: Buffers
  mid: BandBuffers[]
  overStrong: Buffers
  overFine: Buffers
}

/**
 * Merged layers for one station interior, emitted from the deepest level up to the street.
 * Interior layers draw with depthTest off, so buffer order is the overlap rule: upper levels
 * paint over lower ones, within each stroke band (see `decks`).
 */
export function buildInteriorBuffers(interior: StationInterior, opts: InteriorBufferOptions): InteriorLayers {
  const { yScale, colorOf } = opts
  const levelIndex = new Map(interior.levels.map((l, i) => [l.id, i]))
  const indexOf = (levelId: string, elementId: string): number => {
    const i = levelIndex.get(levelId)
    if (i === undefined) throw new Error(`Unknown level "${levelId}" in ${elementId}`)
    return i
  }
  const realY = (i: number) => interior.levels[i]!.y
  const streetIndex = interior.levels.findIndex((l) => l.kind === 'street')
  const decks = opts.decks ?? []
  const bands = Array.from({ length: decks.length + 1 }, () => ({ strong: new SegmentWriter(), fine: new SegmentWriter() }))
  const bandOf = (i: number) => strokeBandOf(i, decks)
  const dash = opts.dashStructure === true
  // A walkway's sides dash like the slabs it joins: on an estimated layout, or when both its ends are approximate slabs.
  const approximateSlabs = new Set(interior.slabs.filter((s) => s.approximate === true).map((s) => s.id))
  const walkwayDash = (c: Connector) => dash || [c.lower.area, c.upper.area].every((a) => a !== undefined && approximateSlabs.has(a))

  // Also throws for an interior with nothing to draw, so it becomes an error load.
  const bounds = interiorBounds(interior)
  const anchors = spreadBanks(interior.connectors, interior.entrances)
  const shared: Omit<ConnectorContext, 'strong' | 'fine'> = {
    realY,
    streetIndex,
    yScale,
    stepRise: opts.stepRise,
    colorOf,
    outOfService: opts.outOfService ?? (() => false),
    axis: stationAxis(interior),
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    anchorOf: (id) => anchors.get(id),
  }
  const cuts = bandCutYs(interior, decks, opts.railDrop, yScale)
  /** Band `from`'s writer, cutting at each deck roof up to band `to`: a SplitAtY chain, nested a band at a time. */
  const chain = (role: 'strong' | 'fine', from: number, to: number): SegmentSink =>
    from >= to ? bands[to]![role] : new SplitAtY(bands[from]![role], chain(role, from + 1, to), cuts[from]!)
  const contexts = new Map<number, ConnectorContext>()
  /** Strokes from the lower level's band up to the upper's (one band: that band's writers). */
  const connectorCtx = (lower: number, upper: number): ConnectorContext => {
    const from = bandOf(lower)
    const to = bandOf(upper)
    const key = from * bands.length + to
    let ctx = contexts.get(key)
    if (!ctx) contexts.set(key, (ctx = { ...shared, strong: chain('strong', from, to), fine: chain('fine', from, to) }))
    return ctx
  }

  for (let li = interior.levels.length - 1; li >= 0; li--) {
    const level = interior.levels[li]!
    const y = level.y * yScale
    const platforms = interior.platforms.filter((p) => indexOf(p.level, p.id) === li)
    const slabs = interior.slabs.filter((s) => indexOf(s.level, s.id) === li)
    const { strong, fine } = bands[bandOf(li)]!

    for (const p of platforms) {
      strong.loop(p.outline, y, colorOf('outline', li), dash)
      for (const t of p.tracks) strong.polyline(t.path, (level.y - opts.railDrop) * yScale, colorOf('track', li))
    }
    for (const s of slabs) strong.loop(s.outline, y, colorOf('outline', li), dash || s.approximate === true)
    for (const f of interior.fareLines) {
      if (indexOf(f.level, f.id) === li) fine.polyline(f.path, y, colorOf('fare', li))
    }

    for (const c of interior.connectors) {
      const lower = indexOf(c.lower.level, c.id)
      const upper = indexOf(c.upper.level, c.id)
      if (c.kind === 'elevator') {
        // The shaft spans every level in between; it stops only at its two ends, each written in
        // that level's pass (and band) so the levels above still paint over it. A shaft through a deck is cut at its
        // trains' roof like a stair or escalator from the platform up.
        if (lower === li) drawElevatorShaft(connectorCtx(lower, upper), c, lower, upper)
        if (lower === li || upper === li) drawElevatorStop(connectorCtx(li, li), c, li)
      } else if (lower === li) {
        const ctx = connectorCtx(lower, upper)
        if (c.kind === 'escalator') drawEscalator(ctx, c, lower, upper)
        else if (c.kind === 'walkway') drawWalkway(ctx, c, lower, walkwayDash(c))
        else drawRamp(ctx, c, lower, upper)
      }
    }

    if (opts.guides && level.kind !== 'street') {
      const cBottom = colorOf('guide', li)
      const cTop = colorOf('guide', streetIndex)
      for (const s of slabs) {
        const slabDash = dash || s.approximate === true
        for (const [x, z] of s.outline) fine.segment([x, y, z], [x, 0, z], cBottom, cTop, slabDash)
        fine.loop(s.outline, 0, cTop, slabDash)
      }
    }

    if (level.kind === 'street') {
      const h = opts.entranceSize / 2
      for (const e of interior.entrances) {
        const square: LocalPoint[] = [
          [e.x - h, e.z - h],
          [e.x + h, e.z - h],
          [e.x + h, e.z + h],
          [e.x - h, e.z + h],
        ]
        strong.loop(square, y, colorOf('entrance', li))
      }
    }
  }

  const built = bands.map((b) => ({ strong: b.strong.build(), fine: b.fine.build() }))
  const base = built[0]!
  if (built.length === 1) {
    const empty = new SegmentWriter().build()
    return { ...base, mid: [], overStrong: empty, overFine: empty }
  }
  const top = built.at(-1)!
  return { ...base, mid: built.slice(1, -1), overStrong: top.strong, overFine: top.fine }
}
