/**
 * The exit path drawn over a station interior: from the platform track a rider steps off, along each connector of an
 * `ExitChoice` exactly where it is drawn (`planEnds`), to its street exit, then along the walk outside. Group-local
 * buffers like the interior's (y × yScale, before the depth factor), in the interior's stroke bands and cut at each
 * deck's train roof the way its connectors are, so the part of the path a lifted train stands in front of stays under
 * it. Pure.
 */
import type { Connector, LocalPoint, StationInterior } from '../data/stationSchema'
import type { ExitChoice } from './exitChoice'
import { planEnds, type ConnectorContext } from './interiorConnectors'
import { connectorContext } from './interiorGeometry'
import { endpointArea } from './interiorGraph'
import { bandSinks, dist3, restroke } from './interiorPathStrokes'
import type { Buffers, Rgb, Vec3 } from './interiorSegments'
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
  /** The platform decks (`interiorDecks`, deepest first; empty under look C): the path splits into their stroke bands. */
  decks: readonly number[]
  /** Linear RGB of every stroke. */
  rgb: Rgb
  /** Dash the path inside the station (a generated interior: the path is probable). */
  dashInStation: boolean
  /** Redraw each connector the path takes, and the exit's entrance square, in the path color. */
  restroke: boolean
  boardHalfM: number
}

export interface ExitPathLayers {
  /** One per stroke band (decks + 1, band 0 first), each drawn over that band's interior strokes and under the next
   *  deck's lifted trains (`strokeOrders(band, count).exitPath`). */
  bands: Buffers[]
  /** Some segment is dashed (in `distances`), so the material must be. */
  dashed: boolean
  /** Group-local x, y, z triples of the path's start (its first point, first connector foot and the board marker): the
   *  level labels keep clear of them on screen. */
  keepOut: Float32Array
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
 * The exit path, one layer per stroke band: the centerline (dashed when `dashInStation`), the board marker (the stretch of track
 * at rail height where the rider is assumed to stand in the train, `boardHalfM` either side of the start), with
 * `restroke` each connector taken and the exit's entrance square, then the walk outside (solid over the walk graph, a
 * dashed straight line when estimated). Throws when the choice doesn't fit the interior.
 */
export function exitPathBuffers(interior: StationInterior, choice: ExitChoice, opts: ExitPathOptions): ExitPathLayers {
  const { rgb, yScale } = opts
  const ctx = connectorContext(interior, { yScale, stepRise: opts.stepRise, colorOf: () => rgb })
  const walk = walkOf(interior, choice, ctx)
  const sinks = bandSinks(interior, opts.decks, opts.railDrop, yScale)
  const { sinkFor, writerOf: levelSink } = sinks
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
    // A walkway dashes like the interior's: on an estimated layout, or between two approximate slabs.
    const rough = new Set(interior.slabs.filter((k) => k.approximate === true).map((k) => k.id))
    for (const piece of walk.pieces) {
      if (piece.kind !== 'connector') continue
      const ends = [piece.c.lower.area, piece.c.upper.area]
      const walkwayDashed = interior.generated !== undefined || ends.every((a) => a !== undefined && rough.has(a))
      if (restroke(ctx, piece.c, piece.lower, piece.upper, sinks, walkwayDashed)) dashed = true
    }
    const e = choice.exit.entranceId === null ? undefined : interior.entrances.find((k) => k.id === choice.exit.entranceId)
    if (e) {
      const h = (opts.entranceSize + 1) / 2
      const square: LocalPoint[] = [[e.x - h, e.z - h], [e.x + h, e.z - h], [e.x + h, e.z + h], [e.x - h, e.z + h]]
      levelSink(street).loop(square, ctx.realY(street) * yScale, rgb)
    }
  }

  // The start the level labels keep clear of: the path's first point, the first connector's foot and the marker.
  const firstConnector = walk.pieces.find((p) => p.kind === 'connector')
  const mid = marker[Math.floor(marker.length / 2)]!
  const keep: Vec3[] = [walk.pieces[0]!.a, ...(firstConnector ? [firstConnector.a] : []), ...[marker[0]!, mid, marker.at(-1)!].map((p): Vec3 => [p[0], railY, p[1]])]
  return { bands: sinks.writers.map((w) => w.build()), dashed, keepOut: new Float32Array(keep.flat()) }
}
