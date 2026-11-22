/**
 * Station interior (public/data/stations/<id>.json) to LineSegments2 buffers.
 * `.ts` import paths: scripts/lib/stationOutputs.test.ts (nodenext) loads this file.
 */
import type { LocalPoint, StationInterior } from '../data/stationSchema.ts'
import { CAR_FLOOR_M, CAR_HEIGHT_M } from './carDims.ts'
import { spreadBanks } from './escalatorBanks.ts'
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
import { SegmentWriter, SplitAtY, type Buffers, type InteriorRole, type Rgb } from './interiorSegments.ts'

export type { Buffers, InteriorRole, Rgb } from './interiorSegments.ts'

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
   */
  dashStructure?: boolean
  /**
   * Index into `interior.levels` of the level the lifted platform trains ride (`trainLevelIndex`). Levels above it
   * (lower indices) go to the `over` layers, drawn after the trains; this level and the ones below stay in the base
   * layers. A stair, escalator or elevator shaft from this level or below up to a level above it is cut at the trains'
   * roof (`trainRoofY`): the part below stays in the base layers, so a car in front of a stair foot hides it, and the
   * rest goes over. Undefined puts everything in the base layers.
   */
  splitLevel?: number
  /** Linear RGB for a role on the level at `levelIndex`, an index into `interior.levels` (highest first, so the
   *  street is 0 below ground and the last level at an elevated station). */
  colorOf: (role: InteriorRole, levelIndex: number) => Rgb
}

/** The base strong and fine layers, and the `over` pair drawn above the lifted platform trains. */
export interface InteriorLayers {
  strong: Buffers
  fine: Buffers
  overStrong: Buffers
  overFine: Buffers
}

/**
 * Drawn y (group-local, before the depth factor) of a lifted train's roof on the platform at `level`: its rail
 * (`yScale` exaggerated like the interior) plus the car's floor and body height (real meters: cars aren't
 * exaggerated). At full tilt and crossScale 1, as at the interior's zoom, for an unselected car: the selected one
 * (widened, lifted 0.2 m) rises about 0.5 m above it, so a stair foot can touch its roof by a pixel or two. A stair foot
 * on the camera side of a car is hidden by it too: strokes have no depth test, so the cut is by height alone.
 */
export function trainRoofY(level: { y: number }, railDrop: number, yScale: number): number {
  return (level.y - railDrop) * yScale + CAR_FLOOR_M + CAR_HEIGHT_M
}

/**
 * Index of the deepest level with a platform track (levels run highest first, so the last such index): where the
 * deepest lifted platform trains ride. Undefined when no platform has a track.
 * Assumes one platform level: on a two-deck station the upper deck's own strokes would go over its trains, so that
 * case logs once (no such station ships today) rather than regressing silently.
 */
export function trainLevelIndex(interior: StationInterior): number | undefined {
  let deepest: number | undefined
  let decks = 0
  interior.levels.forEach((level, i) => {
    if (interior.platforms.some((p) => p.level === level.id && p.tracks.length > 0)) {
      deepest = i
      decks++
    }
  })
  if (decks > 1) warnTwoDecks(interior.stationId)
  return deepest
}

const warnedDecks = new Set<string>()
function warnTwoDecks(id: string): void {
  if (warnedDecks.has(id)) return
  warnedDecks.add(id)
  console.warn(`Interior ${id} has platform tracks on more than one level; its upper deck draws over its own trains`)
}

/**
 * Merged layers for one station interior, emitted from the deepest level up to the street.
 * Interior layers draw with depthTest off, so buffer order is the overlap rule: upper levels
 * paint over lower ones. With `splitLevel`, the levels above it go to the `over` pair instead (see the option).
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
  const base = { strong: new SegmentWriter(), fine: new SegmentWriter() }
  const split = opts.splitLevel
  const over = split === undefined ? base : { strong: new SegmentWriter(), fine: new SegmentWriter() }
  // A level above the split draws over the trains.
  const isOver = (i: number) => split !== undefined && i < split
  const dash = opts.dashStructure === true

  // Also throws for an interior with nothing to draw, so it becomes an error load.
  const bounds = interiorBounds(interior)
  const anchors = spreadBanks(interior.connectors, interior.entrances)
  const shared: Omit<ConnectorContext, 'strong' | 'fine'> = {
    realY,
    streetIndex,
    yScale,
    stepRise: opts.stepRise,
    colorOf,
    dash,
    axis: stationAxis(interior),
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    anchorOf: (id) => anchors.get(id),
  }
  const baseCtx: ConnectorContext = { ...shared, ...base }
  const overCtx: ConnectorContext = { ...shared, ...over }
  // Rising from the split level or below to above it: cut at the trains' roof.
  const roofY = split === undefined ? 0 : trainRoofY(interior.levels[split]!, opts.railDrop, yScale)
  const cutCtx: ConnectorContext = {
    ...shared,
    strong: new SplitAtY(base.strong, over.strong, roofY),
    fine: new SplitAtY(base.fine, over.fine, roofY),
  }
  const connectorCtx = (lower: number, upper: number) => {
    if (!isOver(upper)) return baseCtx
    return isOver(lower) ? overCtx : cutCtx
  }

  for (let li = interior.levels.length - 1; li >= 0; li--) {
    const level = interior.levels[li]!
    const y = level.y * yScale
    const platforms = interior.platforms.filter((p) => indexOf(p.level, p.id) === li)
    const slabs = interior.slabs.filter((s) => indexOf(s.level, s.id) === li)
    const { strong, fine } = isOver(li) ? over : base

    for (const p of platforms) {
      strong.loop(p.outline, y, colorOf('outline', li), dash)
      for (const t of p.tracks) strong.polyline(t.path, (level.y - opts.railDrop) * yScale, colorOf('track', li))
    }
    for (const s of slabs) strong.loop(s.outline, y, colorOf('outline', li), dash)
    for (const f of interior.fareLines) {
      if (indexOf(f.level, f.id) === li) fine.polyline(f.path, y, colorOf('fare', li))
    }

    for (const c of interior.connectors) {
      const lower = indexOf(c.lower.level, c.id)
      const upper = indexOf(c.upper.level, c.id)
      if (c.kind === 'elevator') {
        // The shaft spans every level in between; it stops only at its two ends, each written in
        // that level's pass so the levels above still paint over it. A shaft through the split is cut at the trains'
        // roof like a stair or escalator from the platform up.
        if (lower === li) drawElevatorShaft(connectorCtx(lower, upper), c, lower, upper)
        if (lower === li || upper === li) drawElevatorStop(isOver(li) ? overCtx : baseCtx, c, li)
      } else if (lower === li) {
        const ctx = connectorCtx(lower, upper)
        if (c.kind === 'escalator') drawEscalator(ctx, c, lower, upper)
        else if (c.kind === 'walkway') drawWalkway(ctx, c, lower)
        else drawRamp(ctx, c, lower, upper)
      }
    }

    if (opts.guides && level.kind !== 'street') {
      const cBottom = colorOf('guide', li)
      const cTop = colorOf('guide', streetIndex)
      for (const s of slabs) {
        for (const [x, z] of s.outline) fine.segment([x, y, z], [x, 0, z], cBottom, cTop, dash)
        fine.loop(s.outline, 0, cTop, dash)
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

  const built = { strong: base.strong.build(), fine: base.fine.build() }
  if (over === base) {
    const empty = new SegmentWriter().build()
    return { ...built, overStrong: empty, overFine: empty }
  }
  return { ...built, overStrong: over.strong.build(), overFine: over.fine.build() }
}
