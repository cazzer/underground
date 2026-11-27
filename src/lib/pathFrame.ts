/**
 * What a landing on an interior frames first, the priority frame: the trip's path there while the trip panel is open
 * (its way out at the To station, or a change of trains inside a complex; exitPathCenterline), then the machines out of
 * service (outageFrame.ts), rather than the interior's middle, so they sit in the free area above the panel. Pure: the
 * points freeFrame frames, in priority order, and the stations whose points the target stays near.
 */
import type { LocalPoint, StationInterior } from '../data/stationSchema'
import { convexHull } from './basemap/networkHull'
import { framedCount, freeFrame, type FramePoint, type FreeFrame, type FreeFrameInput } from './freeFrame'
import { interiorBounds } from './interiorFraming'
import { stationPathPoints, type StationPathChoice } from './interiorPath'
import type { Vec3 } from './interiorSegments'
import { panRadius } from './orbitLimits'
import type { Ground } from './projection'

/** The parts of an interior model the priority frame reads (InteriorModel has them). */
export interface PriorityFrameModel {
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

/** A freeFrame request over an interior; `interiorId` is the model's (file) id it was built for. */
export interface PriorityFrame {
  interiorId: string
  /**
   * In priority order: the path's marker ends at rail height (the board marker's, then a transfer's second) and its
   * centerline, the out-of-service machines' ends, the interior's outline per level (convex hull vertices, nearest the
   * path's board first, else nearest the machines' middle), then the exit's or way in's walk outside.
   */
  wanted: FramePoint[]
  /** How many of `wanted` come first as the path itself (the marker ends and the centerline); 0 with no path. */
  pathCount: number
  /** How many come next as the out-of-service machines' ends. */
  outageCount: number
  /** The interior's plan center at its mid-height: the plain landing's center. */
  center: FramePoint
  /** The interior's member stations: the target stays near one of them. */
  anchors: Ground[]
  /** The target stays this close to the centred one: the orbit's pan radius, so the landing never springs back. */
  centerRadius: number
}

/** The path's points as drawn, or null (with one console.error) when the choice doesn't fit the interior. */
function pathPoints(model: PriorityFrameModel, choice: StationPathChoice, o: PathFrameOptions): { markers: Vec3[]; line: Vec3[] } | null {
  try {
    return stationPathPoints(model.interior, choice, { yScale: model.yScale, stepRise: o.stepRise, railDrop: o.railDrop, boardHalfM: o.boardHalfM })
  } catch (e) {
    console.error(`Path frame at ${model.stationId}: framing the interior without it`, e)
    return null
  }
}

/**
 * The frame for the trip's path `path` (null for none) and the out-of-service machines' points `outages`
 * (outageFramePoints) over `model`, `anchors` the scene points of the stations it covers; null when there is neither (a
 * path that doesn't fit the interior counts as none), so the landing frames the interior as usual.
 */
export function priorityFrameOf(
  model: PriorityFrameModel,
  path: StationPathChoice | null,
  outages: readonly FramePoint[],
  anchors: readonly Ground[],
  o: PathFrameOptions,
): PriorityFrame | null {
  const { interior, origin, yScale } = model
  const points = path ? pathPoints(model, path, o) : null
  if (!points && outages.length === 0) return null
  const markers = points?.markers ?? []
  const line = points?.line ?? []
  const at = (p: Vec3): FramePoint => ({ x: origin.x + p[0], y: p[1], z: origin.z + p[2] })
  // Group-local plan points the outline is wanted nearest: the board marker's ends, else the machines' ends.
  const near: Ground[] = points ? markers.slice(0, 2).map((p) => ({ x: p[0], z: p[2] })) : outages.map((p) => ({ x: p.x - origin.x, z: p.z - origin.z }))
  const mid = { x: near.reduce((s, p) => s + p.x, 0) / near.length, z: near.reduce((s, p) => s + p.z, 0) / near.length }

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

  // The walk outside, from the exit or to the entrance: its street points, or for an estimate the place it runs to or from.
  const end = path?.kind === 'exit' ? path.destination : path?.kind === 'board' ? path.origin : null
  const walk: FramePoint[] =
    !points || (path?.kind !== 'exit' && path?.kind !== 'board')
      ? []
      : path.walk?.kind === 'route'
        ? path.walk.points.map((g) => ({ x: g.x, y: 0, z: g.z }))
        : path.walk?.kind === 'estimate' && end
          ? [{ x: end.x, y: 0, z: end.z }]
          : []

  const b = interiorBounds(interior)
  const ys = interior.levels.map((l) => l.y)
  return {
    interiorId: model.stationId,
    wanted: [...markers.map(at), ...line.map(at), ...outages, ...hull.map((h) => at(h.p)), ...walk],
    pathCount: markers.length + line.length,
    outageCount: outages.length,
    center: { x: origin.x + (b.minX + b.maxX) / 2, y: ((Math.min(...ys) + Math.max(...ys)) / 2) * yScale, z: origin.z + (b.minZ + b.maxZ) / 2 },
    anchors: [...anchors],
    centerRadius: panRadius(model.focusAnchor.reach),
  }
}

/** The frame's priority points by tier: the path's, then the machines'. */
export function priorityTiers(frame: PriorityFrame): [FramePoint[], FramePoint[]] {
  const { wanted, pathCount, outageCount } = frame
  return [wanted.slice(0, pathCount), wanted.slice(pathCount, pathCount + outageCount)]
}

/**
 * Whether `a` (counts by tier: path, machines; a bare station's point, complex members, marks) shows more than `b`: more
 * of the first tier where they differ.
 */
export function showsMore(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

/**
 * The landing for `frame` in this view: `plain` (the interior framed as usual, frameInterior) when it already shows
 * the whole path and every machine, else freeFrame's frame (nothing required, the target within TARGET_RADIUS_M of a
 * member) when it shows more of the path, or as much of it and more of the machines, than `plain` does; else `plain`.
 * The plain phone landing often holds its target farther from the station than that radius, so for a small interior it
 * can show points the radius can't reach.
 */
export function priorityLanding(frame: PriorityFrame, view: FrameView, plain: Landing): Landing {
  const tiers = priorityTiers(frame)
  const shown = tiers.map((t) => framedCount(view, plain, t))
  if (shown.every((n, i) => n === tiers[i]!.length)) return plain
  const { wanted, center, anchors, centerRadius } = frame
  const f = freeFrame({ required: [], wanted, center, anchors, centerRadius, ...view })
  return showsMore(
    tiers.map((t) => framedCount(view, f, t)),
    shown,
  )
    ? f
    : plain
}
