/**
 * The walk a station path takes through an interior (interiorPath.ts): flat pieces on a level and each connector run
 * exactly where it is drawn (`planEnds`), from the platform track a rider steps off at to its street exit (a way in runs
 * the same way, from the track it boards at out to its entry), or for a transfer to the next train's track. Group-local
 * drawn points (y × yScale, before the depth factor). Pure.
 */
import type { Connector, LocalPoint, StationInterior } from '../data/stationSchema'
import type { BoardChoice, ExitChoice } from './exitChoice'
import { planEnds, type ConnectorContext } from './interiorConnectors'
import { endpointArea } from './interiorGraph'
import { dist3 } from './interiorPathStrokes'
import type { TransferChoice } from './interiorTransfer'
import type { Vec3 } from './interiorSegments'
import { nearestOnPolyline } from './planGeometry'

/** What a station path draws: the way out at a trip's To station, the way in at its From station (drawn the same way,
 *  platform to street), or a change of trains inside a complex. */
export type StationPathChoice = ExitChoice | BoardChoice | TransferChoice

export type Piece =
  | { kind: 'flat'; level: number; a: Vec3; b: Vec3 }
  | { kind: 'connector'; c: Connector; lower: number; upper: number; a: Vec3; b: Vec3; fromLevel: number; toLevel: number }

/** A stretch of platform track and a point on it. */
export interface TrackAt {
  track: readonly LocalPoint[]
  /** Meters along `track`. */
  along: number
  /** Index into `interior.levels` of the track's platform level. */
  level: number
}

export interface Walk {
  pieces: Piece[]
  /** Where the path starts over the track the rider steps off at (or, for a way in, boards at). */
  start: TrackAt
  /** A transfer's end over the next train's track; null for an exit or a way in. */
  end: TrackAt | null
}

export type PlanCtx = Omit<ConnectorContext, 'strong' | 'fine'>

const PATH_NAME: Readonly<Record<StationPathChoice['kind'], string>> = { exit: 'Exit', board: 'Way-in', transfer: 'Transfer' }

export function walkOf(interior: StationInterior, choice: StationPathChoice, ctx: PlanCtx): Walk {
  const where = `${PATH_NAME[choice.kind]} path at ${interior.stationId}`
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
  let end: TrackAt | null = null
  if (choice.kind === 'exit' || choice.kind === 'board') {
    if (choice.exit.entranceId !== null) pieces.push({ kind: 'flat', level, a: at3(point!, level), b: at3(choice.exit.point, level) })
  } else {
    // The next train's track on the platform the last connector lands on, nearest that landing.
    const onto = interior.platforms.find((p) => p.id === area)
    const next = onto?.tracks.filter((t) => t.stopId === choice.toStopId) ?? []
    if (next.length === 0) throw new Error(`${where}: the route ends in ${area ?? 'the street'}, not on a platform with a track for ${choice.toStopId}`)
    let best = { track: next[0]!.path, hit: nearestOnPolyline(next[0]!.path, point!) }
    for (const t of next) {
      const hit = nearestOnPolyline(t.path, point!)
      if (hit.distance < best.hit.distance) best = { track: t.path, hit }
    }
    pieces.push({ kind: 'flat', level, a: at3(point!, level), b: at3(best.hit.point, level) })
    end = { track: best.track, along: best.hit.along, level }
  }
  return { pieces: pieces.filter((p) => p.kind === 'connector' || dist3(p.a, p.b) > 1e-6), start: { track, along, level: platformLevel }, end }
}
