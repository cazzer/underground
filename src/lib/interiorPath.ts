/**
 * The exit path drawn over a station interior: from the platform track a rider steps off, along each connector of an
 * `ExitChoice` exactly where it is drawn (`planEnds`), to its street exit, then along the walk outside. Group-local
 * buffers like the interior's (y × yScale, before the depth factor), split at the trains' roof the way its connectors
 * are, so the part of the path a lifted train stands in front of stays under it. Pure.
 */
import type { Connector, LocalPoint, StationInterior } from '../data/stationSchema'
import type { ExitChoice } from './exitChoice'
import {
  drawElevatorShaft,
  drawElevatorStop,
  drawEscalator,
  drawRamp,
  drawWalkway,
  planEnds,
  type ConnectorContext,
} from './interiorConnectors'
import { connectorContext, trainRoofY } from './interiorGeometry'
import { endpointArea } from './interiorGraph'
import { SegmentWriter, SplitAtY, type Buffers, type Rgb, type SegmentSink, type Vec3 } from './interiorSegments'
import { nearestOnPolyline, slicePolyline } from './planGeometry'
import { toGround } from './projection'

/** Half the length of the board marker along the track, meters: about one car either side of the platform point. */
export const BOARD_HALF_M = 9

export interface ExitPathOptions {
  /** Vertical exaggeration, as the interior's. */
  yScale: number
  /** Real rise per drawn stair step (the restroked stairs' hatch). */
  stepRise: number
  /** Platform edge to rail head, meters: the board marker's height. */
  railDrop: number
  /** The interior's entrance square side, meters: the exit's is redrawn 1 m larger. */
  entranceSize: number
  /** `trainLevelIndex`, as the interior's layers split; undefined draws everything in `under`. */
  splitLevel?: number
  /** Linear RGB of every stroke. */
  rgb: Rgb
  /** Dash the path inside the station (a generated interior: the path is probable). */
  dashInStation: boolean
  /** Redraw each connector the path takes, and the exit's entrance square, in the path color. */
  restroke: boolean
  boardHalfM: number
}

export interface ExitPathLayers {
  /** Drawn with the interior's base layers: the platform level the lifted trains ride and below. */
  under: Buffers
  /** Drawn over the lifted trains, with the levels above them. */
  over: Buffers
  /** Some segment is dashed (in `distances`), so the material must be. */
  dashed: boolean
}

export interface PathPoint {
  p: Vec3
  /** Index into `interior.levels` of the level the point stands on. */
  level: number
}

type Piece =
  | { kind: 'flat'; level: number; a: Vec3; b: Vec3 }
  | { kind: 'connector'; c: Connector; lower: number; upper: number; a: Vec3; b: Vec3; fromLevel: number; toLevel: number }

interface Walk {
  pieces: Piece[]
  track: readonly LocalPoint[]
  /** Meters along `track` of the point the path starts over. */
  along: number
  platformLevel: number
}

type PlanCtx = Omit<ConnectorContext, 'strong' | 'fine'>

function walkOf(interior: StationInterior, choice: ExitChoice, ctx: PlanCtx): Walk {
  const where = `Exit path at ${interior.stationId}`
  const levelIndex = new Map(interior.levels.map((l, i) => [l.id, i]))
  const indexOf = (id: string): number => {
    const i = levelIndex.get(id)
    if (i === undefined) throw new Error(`${where}: unknown level "${id}"`)
    return i
  }
  const drawnY = (i: number): number => ctx.realY(i) * ctx.yScale
  const at3 = (p: LocalPoint, level: number): Vec3 => [p[0], drawnY(level), p[1]]
  const platform = interior.platforms.find((p) => p.id === choice.areaIds[0])
  if (!platform) throw new Error(`${where}: no platform "${choice.areaIds[0]}"`)
  const tracks = platform.tracks.filter((t) => t.stopId === choice.stopId)
  if (tracks.length === 0) throw new Error(`${where}: platform ${platform.id} has no track for ${choice.stopId}`)
  if (choice.connectorIds.length === 0) throw new Error(`${where}: the route takes no connector`)
  const platformLevel = indexOf(platform.level)
  const pieces: Piece[] = []
  let area: string | null = platform.id
  let level = platformLevel
  let point: LocalPoint | null = null
  let track: readonly LocalPoint[] = tracks[0]!.path
  let along = 0
  for (const id of choice.connectorIds) {
    const c = interior.connectors.find((k) => k.id === id)
    if (!c) throw new Error(`${where}: no connector "${id}"`)
    const [lower, upper] = [indexOf(c.lower.level), indexOf(c.upper.level)]
    const ends = planEnds(ctx, c, lower, upper)
    const sides = [
      { end: c.lower, point: ends.lower, level: lower },
      { end: c.upper, point: ends.upper, level: upper },
    ]
    const here = sides.filter((s) => s.level === level && endpointArea(interior, s.end) === area)
    if (here.length === 0) throw new Error(`${where}: connector ${id} has no end in ${area ?? 'the street'}`)
    const from: LocalPoint | null = point
    const dist = (s: (typeof sides)[number]): number =>
      from ? Math.hypot(s.point[0] - from[0], s.point[1] - from[1]) : nearestOnPolyline(track, s.point).distance
    const enter = here.length === 2 && dist(here[1]!) < dist(here[0]!) ? here[1]! : here[0]!
    const leave = enter === sides[0] ? sides[1]! : sides[0]!
    if (from === null) {
      // The track (of the stop's, on this platform) nearest the first connector, and the point on it below that end.
      let best = nearestOnPolyline(track, enter.point)
      for (const t of tracks) {
        const hit = nearestOnPolyline(t.path, enter.point)
        if (hit.distance < best.distance) [track, best] = [t.path, hit]
      }
      along = best.along
      pieces.push({ kind: 'flat', level, a: at3(best.point, level), b: at3(enter.point, level) })
    } else {
      pieces.push({ kind: 'flat', level, a: at3(from, level), b: at3(enter.point, level) })
    }
    pieces.push({ kind: 'connector', c, lower, upper, a: at3(enter.point, enter.level), b: at3(leave.point, leave.level), fromLevel: enter.level, toLevel: leave.level })
    point = leave.point
    level = leave.level
    area = endpointArea(interior, leave.end)
  }
  if (choice.exit.entranceId !== null) pieces.push({ kind: 'flat', level, a: at3(point!, level), b: at3(choice.exit.point, level) })
  return { pieces: pieces.filter((p) => p.kind === 'connector' || dist3(p.a, p.b) > 1e-6), track, along, platformLevel }
}

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

/** The path's in-station centerline, platform track to street exit: each point and the level it stands on. */
export function exitPathCenterline(interior: StationInterior, choice: ExitChoice, opts: Pick<ExitPathOptions, 'yScale' | 'stepRise'>): PathPoint[] {
  const ctx = connectorContext(interior, { ...opts, colorOf: () => [0, 0, 0] })
  const { pieces } = walkOf(interior, choice, ctx)
  const first = pieces[0]!
  const out: PathPoint[] = [{ p: first.a, level: first.kind === 'flat' ? first.level : first.fromLevel }]
  for (const piece of pieces) out.push({ p: piece.b, level: piece.kind === 'flat' ? piece.level : piece.toLevel })
  return out
}

/**
 * A SegmentWriter whose dashed segments carry one running dash distance, shared with every writer given the same
 * `run`, so the dash phase flows on along the path, across layers and the roof cut. Solid segments are 0, 0.
 */
class PathWriter extends SegmentWriter {
  private readonly run: { m: number }

  constructor(run: { m: number }) {
    super()
    this.run = run
  }

  override segment(a: Vec3, b: Vec3, ca: Rgb, cb: Rgb = ca, dashed = false): void {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    this.colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2])
    if (!dashed) {
      this.distances.push(0, 0)
      return
    }
    const m = this.run.m
    this.run.m = m + dist3(a, b)
    this.distances.push(m, this.run.m)
  }
}

/**
 * Which of the path's layers level `i` (an index into `interior.levels`) draws in: 0 with the interior's base layers,
 * 1 over the lifted platform trains (a level above `splitLevel`). The one place a level is routed.
 */
export function layerOfLevel(i: number, splitLevel: number | undefined): number {
  return splitLevel !== undefined && i < splitLevel ? 1 : 0
}

/**
 * Drawn heights (group-local, ascending) where a segment from level `lower` up to level `upper` moves from one layer
 * to the next: the trains' roof when it rises from the split level or below to above it, else none. The one place a
 * crossing segment is cut.
 */
export function cutYsBetween(interior: StationInterior, lower: number, upper: number, opts: Pick<ExitPathOptions, 'splitLevel' | 'railDrop' | 'yScale'>): number[] {
  const split = opts.splitLevel
  if (split === undefined || layerOfLevel(lower, split) === layerOfLevel(upper, split)) return []
  return [trainRoofY(interior.levels[split]!, opts.railDrop, opts.yScale)]
}

const NO_SINK: SegmentSink = { segment: () => {}, loop: () => {} }

/** Restrokes the connector a path piece takes, in the path color, into the sink(s) its levels draw in. */
function restroke(ctx: PlanCtx, piece: Extract<Piece, { kind: 'connector' }>, sinkFor: (l: number, u: number) => SegmentSink, levelSink: (i: number) => SegmentSink): void {
  const { c, lower, upper } = piece
  const run: ConnectorContext = { ...ctx, strong: sinkFor(lower, upper), fine: NO_SINK }
  if (c.kind === 'elevator') {
    drawElevatorShaft(run, c, lower, upper)
    for (const i of [lower, upper]) drawElevatorStop({ ...ctx, strong: levelSink(i), fine: NO_SINK }, c, i)
  } else if (c.kind === 'escalator') drawEscalator(run, c, lower, upper)
  else if (c.kind === 'walkway') drawWalkway(run, c, lower, false)
  else drawRamp(run, c, lower, upper)
}

/**
 * The exit path's two layers: the centerline (dashed when `dashInStation`), the board marker (the stretch of track
 * at rail height where the rider is assumed to stand in the train, `boardHalfM` either side of the start), with
 * `restroke` each connector taken and the exit's entrance square, then the walk outside (solid over the walk graph, a
 * dashed straight line when estimated). Throws when the choice doesn't fit the interior.
 */
export function exitPathBuffers(interior: StationInterior, choice: ExitChoice, opts: ExitPathOptions): ExitPathLayers {
  const { rgb, yScale, splitLevel: split } = opts
  const ctx = connectorContext(interior, { yScale, stepRise: opts.stepRise, colorOf: () => rgb })
  const walk = walkOf(interior, choice, ctx)
  const run = { m: 0 }
  const base = new PathWriter(run)
  const layers = split === undefined ? [base] : [base, new PathWriter(run)]
  const levelSink = (i: number): SegmentSink => layers[layerOfLevel(i, split)]!
  const sinkFor = (lower: number, upper: number): SegmentSink => {
    const cuts = cutYsBetween(interior, lower, upper, opts)
    if (cuts.length === 0) return levelSink(upper)
    if (cuts.length > 1) throw new Error(`Exit path at ${interior.stationId}: a connector crosses ${cuts.length} layer cuts`)
    return new SplitAtY(layers[layerOfLevel(lower, split)]!, layers[layerOfLevel(upper, split)]!, cuts[0]!)
  }
  const dash = opts.dashInStation
  let dashed = dash

  for (const piece of walk.pieces) {
    const sink = piece.kind === 'flat' ? levelSink(piece.level) : sinkFor(piece.lower, piece.upper)
    sink.segment(piece.a, piece.b, rgb, rgb, dash)
  }

  const street = ctx.streetIndex
  const origin = toGround(interior.anchor)
  if (choice.walk?.kind === 'route') {
    const local = choice.walk.points.map((g): Vec3 => [g.x - origin.x, 0, g.z - origin.z])
    for (let i = 1; i < local.length; i++) if (dist3(local[i - 1]!, local[i]!) > 1e-6) levelSink(street).segment(local[i - 1]!, local[i]!, rgb)
  } else if (choice.walk?.kind === 'estimate' && choice.destination) {
    const to: Vec3 = [choice.destination.x - origin.x, 0, choice.destination.z - origin.z]
    levelSink(street).segment([choice.exit.point[0], 0, choice.exit.point[1]], to, rgb, rgb, true)
    dashed = true
  }

  const total = nearestOnPolyline(walk.track, walk.track[0]!).total
  const length = Math.min(2 * opts.boardHalfM, total)
  const from = Math.max(0, Math.min(walk.along - length / 2, total - length))
  const marker = slicePolyline(walk.track, from, from + length)
  const railY = (interior.levels[walk.platformLevel]!.y - opts.railDrop) * yScale
  for (let i = 1; i < marker.length; i++) {
    const [p, q] = [marker[i - 1]!, marker[i]!]
    levelSink(walk.platformLevel).segment([p[0], railY, p[1]], [q[0], railY, q[1]], rgb, rgb, dash)
  }

  if (opts.restroke) {
    for (const piece of walk.pieces) if (piece.kind === 'connector') restroke(ctx, piece, sinkFor, levelSink)
    const e = choice.exit.entranceId === null ? undefined : interior.entrances.find((k) => k.id === choice.exit.entranceId)
    if (e) {
      const h = (opts.entranceSize + 1) / 2
      const square: LocalPoint[] = [[e.x - h, e.z - h], [e.x + h, e.z - h], [e.x + h, e.z + h], [e.x - h, e.z + h]]
      levelSink(street).loop(square, ctx.realY(street) * yScale, rgb)
    }
  }

  return { under: base.build(), over: (layers[1] ?? new SegmentWriter()).build(), dashed }
}
