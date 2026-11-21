/**
 * Station interior (public/data/stations/<id>.json) to LineSegments2 buffers.
 * `.ts` import paths: scripts/lib/stationOutputs.test.ts (nodenext) loads this file.
 */
import type { LocalPoint, StationInterior } from '../data/stationSchema.ts'
import { spreadBanks } from './escalatorBanks.ts'
import { stationAxis } from './interiorAxis.ts'
import { interiorBounds } from './interiorFraming.ts'
import {
  drawElevatorShaft,
  drawElevatorStop,
  drawEscalator,
  drawRamp,
  type ConnectorContext,
} from './interiorConnectors.ts'
import { SegmentWriter, type Buffers, type InteriorRole, type Rgb } from './interiorSegments.ts'

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
   * TEMPORARY (approxLook.ts, look B): mark platform and slab outlines, the slab guides and their street-level copy
   * as dashed in `distances` (tracks stay solid). Positions and colors are the same either way.
   */
  dashStructure?: boolean
  /** Linear RGB for a role on the level at `levelIndex`, an index into `interior.levels` (highest first, so the
   *  street is 0 below ground and the last level at an elevated station). */
  colorOf: (role: InteriorRole, levelIndex: number) => Rgb
}

/**
 * Two merged layers for one station interior, emitted from the deepest level up to the street.
 * Interior layers draw with depthTest off, so buffer order is the overlap rule: upper levels
 * paint over lower ones.
 */
export function buildInteriorBuffers(
  interior: StationInterior,
  opts: InteriorBufferOptions,
): { strong: Buffers; fine: Buffers } {
  const { yScale, colorOf } = opts
  const levelIndex = new Map(interior.levels.map((l, i) => [l.id, i]))
  const indexOf = (levelId: string, elementId: string): number => {
    const i = levelIndex.get(levelId)
    if (i === undefined) throw new Error(`Unknown level "${levelId}" in ${elementId}`)
    return i
  }
  const realY = (i: number) => interior.levels[i]!.y
  const streetIndex = interior.levels.findIndex((l) => l.kind === 'street')
  const strong = new SegmentWriter()
  const fine = new SegmentWriter()
  const dash = opts.dashStructure === true

  // Also throws for an interior with nothing to draw, so it becomes an error load.
  const bounds = interiorBounds(interior)
  const anchors = spreadBanks(interior.connectors, interior.entrances)
  const ctx: ConnectorContext = {
    strong,
    fine,
    realY,
    streetIndex,
    yScale,
    stepRise: opts.stepRise,
    colorOf,
    axis: stationAxis(interior),
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    anchorOf: (id) => anchors.get(id),
  }

  for (let li = interior.levels.length - 1; li >= 0; li--) {
    const level = interior.levels[li]!
    const y = level.y * yScale
    const platforms = interior.platforms.filter((p) => indexOf(p.level, p.id) === li)
    const slabs = interior.slabs.filter((s) => indexOf(s.level, s.id) === li)

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
        // that level's pass so the levels above still paint over it.
        if (lower === li) drawElevatorShaft(ctx, c, lower, upper)
        if (lower === li || upper === li) drawElevatorStop(ctx, c, li)
      } else if (lower === li) {
        if (c.kind === 'escalator') drawEscalator(ctx, c, lower, upper)
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

  return { strong: strong.build(), fine: fine.build() }
}
