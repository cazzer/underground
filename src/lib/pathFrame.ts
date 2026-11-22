/**
 * What a landing on a station the trip draws a path at frames while the trip panel is open: that path (its way out at
 * the To station, or a change of trains inside a complex; exitPathCenterline) rather than the interior's middle, so it
 * sits in the free area above the panel. Pure: the points freeFrame frames, in priority order, and the stations whose
 * points the target stays near.
 */
import type { LocalPoint, StationInterior } from '../data/stationSchema'
import { convexHull } from './basemap/networkHull'
import { framedCount, freeFrame, type FramePoint, type FreeFrame, type FreeFrameInput } from './freeFrame'
import { interiorBounds } from './interiorFraming'
import { stationPathPoints, type StationPathChoice } from './interiorPath'
import type { Vec3 } from './interiorSegments'
import { panRadius } from './orbitLimits'
import type { Ground } from './projection'

/** The parts of an interior model the path frame reads (InteriorModel has them). */
export interface PathFrameModel {
  stationId: string
  interior: StationInterior
  /** Scene position of the interior's local origin. */
  origin: Ground
  yScale: number
  focusAnchor: { reach: number }
}

type FrameView = Pick<FreeFrameInput, 'azimuth' | 'viewport' | 'free' | 'fovDeg'>
type Landing = Pick<FreeFrame, 'distance' | 'target'>

export interface PathFrameOptions {
  /** Real rise per drawn stair step, as the path draws it. */
  stepRise: number
  /** Platform edge to rail head, meters: the board marker's height. */
  railDrop: number
  boardHalfM: number
}

/** A freeFrame request for a path over an interior; `interiorId` is the model's (file) id it was built for. */
export interface PathFrame {
  interiorId: string
  /**
   * In priority order: the markers' ends at rail height (the board marker's, then a transfer's second), the path's
   * centerline, the interior's outline per level (convex hull vertices, nearest the board first), then an exit's walk
   * outside.
   */
  wanted: FramePoint[]
  /** How many of `wanted` come first as the path itself (the marker ends and the centerline). */
  pathCount: number
  /** The interior's plan center at its mid-height: the plain landing's center. */
  center: FramePoint
  /** The interior's member stations: the target stays near one of them. */
  anchors: Ground[]
  /** The target stays this close to the centred one: the orbit's pan radius, so the landing never springs back. */
  centerRadius: number
}

/**
 * The frame for the path `choice` over `model`, `anchors` the scene points of the stations it covers; null (with one
 * console.error) when the choice doesn't fit the interior, so the landing frames the interior as usual.
 */
export function stationPathFrameOf(model: PathFrameModel, choice: StationPathChoice, anchors: readonly Ground[], o: PathFrameOptions): PathFrame | null {
  const { interior, origin, yScale } = model
  let points: { markers: Vec3[]; line: Vec3[] }
  try {
    points = stationPathPoints(interior, choice, { yScale, stepRise: o.stepRise, railDrop: o.railDrop, boardHalfM: o.boardHalfM })
  } catch (e) {
    console.error(`Path frame at ${model.stationId}: framing the interior instead`, e)
    return null
  }
  const { markers, line } = points
  const at = (p: Vec3): FramePoint => ({ x: origin.x + p[0], y: p[1], z: origin.z + p[2] })
  const mid = { x: (markers[0]![0] + markers[1]![0]) / 2, z: (markers[0]![2] + markers[1]![2]) / 2 }

  const hull: { p: Vec3; d: number }[] = []
  interior.levels.forEach((level, i) => {
    const plan: LocalPoint[] = [
      ...interior.platforms.filter((p) => p.level === level.id).flatMap((p) => p.outline),
      ...interior.slabs.filter((s) => s.level === level.id).flatMap((s) => s.outline),
      ...(level.kind === 'street' ? interior.entrances.map((e): LocalPoint => [e.x, e.z]) : []),
    ]
    if (plan.length === 0) return
    const y = interior.levels[i]!.y * yScale
    for (const g of convexHull(plan.map(([x, z]) => ({ x, z })))) hull.push({ p: [g.x, y, g.z], d: Math.hypot(g.x - mid.x, g.z - mid.z) })
  })
  hull.sort((a, b) => a.d - b.d)

  const walk: FramePoint[] =
    choice.kind !== 'exit'
      ? []
      : choice.walk?.kind === 'route'
      ? choice.walk.points.map((g) => ({ x: g.x, y: 0, z: g.z }))
      : choice.walk?.kind === 'estimate' && choice.destination
        ? [{ x: choice.destination.x, y: 0, z: choice.destination.z }]
        : []

  const b = interiorBounds(interior)
  const ys = interior.levels.map((l) => l.y)
  return {
    interiorId: model.stationId,
    wanted: [...markers.map(at), ...line.map(at), ...hull.map((h) => at(h.p)), ...walk],
    pathCount: markers.length + line.length,
    center: { x: origin.x + (b.minX + b.maxX) / 2, y: ((Math.min(...ys) + Math.max(...ys)) / 2) * yScale, z: origin.z + (b.minZ + b.maxZ) / 2 },
    anchors: [...anchors],
    centerRadius: panRadius(model.focusAnchor.reach),
  }
}

/**
 * The landing for `path` in this view: `plain` (the interior framed as usual, frameInterior) when it already shows the
 * whole path, else freeFrame's frame (nothing required, the target within TARGET_RADIUS_M of a member) when it shows
 * more of the path than `plain` does; else `plain`. The plain phone landing often holds its target farther from the
 * station than that radius, so for a small interior it can show a path the radius can't reach.
 */
export function pathLanding(frame: PathFrame, view: FrameView, plain: Landing): Landing {
  const path = frame.wanted.slice(0, frame.pathCount)
  const shown = framedCount(view, plain, path)
  if (shown === path.length) return plain
  const { wanted, center, anchors, centerRadius } = frame
  const f = freeFrame({ required: [], wanted, center, anchors, centerRadius, ...view })
  return framedCount(view, f, path) > shown ? f : plain
}
