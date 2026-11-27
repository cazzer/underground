/**
 * The station path drawn over an interior: from the platform track a rider steps off, along each connector exactly
 * where it is drawn (`planEnds`), to its street exit (an `ExitChoice`), to the entry it was reached from (a
 * `BoardChoice`, the way in, drawn as an exit), or to the next train's track (a `TransferChoice`, with a second
 * marker there). The walk outside the station is not drawn here: the map's dashed walk (TripDashes) is the only
 * drawing of it, at every zoom. Group-local
 * buffers like the interior's (y × yScale, before the depth factor), in the interior's stroke bands and cut at each
 * deck's train roof the way its connectors are, so the part of the path a lifted train stands in front of stays under
 * it. Pure.
 */
import type { LocalPoint, StationInterior } from '../data/stationSchema'
import { connectorContext } from './interiorGeometry'
import { bandSinks, restroke } from './interiorPathStrokes'
import { walkOf, type StationPathChoice, type TrackAt, type Walk } from './interiorPathWalk'
import type { Buffers, Rgb, Vec3 } from './interiorSegments'
import { nearestOnPolyline, slicePolyline } from './planGeometry'

export type { StationPathChoice } from './interiorPathWalk'

/** A station path the scene draws, keyed by the interior file it draws in. */
export interface StationPathDraw {
  interiorId: string
  choice: StationPathChoice
}

/** A key for a path's error boundary: a new path remounts it. */
export function stationPathKey(choice: StationPathChoice): string {
  switch (choice.kind) {
    case 'exit':
      return `${choice.stopId}>${choice.exit.entranceId ?? ''}`
    case 'board':
      return `board:${choice.stopId}<${choice.exit.entranceId ?? ''}`
    case 'transfer':
      return `${choice.stopId}>${choice.toStopId}>${choice.connectorIds.join(',')}`
  }
}

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
  /** Group-local x, y, z triples of the path's start (its first point, first connector foot and the board marker) and,
   *  for a transfer, its end marker: the level labels keep clear of them on screen. */
  keepOut: Float32Array
}

export interface PathPoint {
  p: Vec3
  /** Index into `interior.levels` of the level the point stands on. */
  level: number
}

/** The path's in-station centerline, platform track to street exit (or to the next train's track): each point and the
 *  level it stands on. */
export function exitPathCenterline(interior: StationInterior, choice: StationPathChoice, opts: Pick<ExitPathOptions, 'yScale' | 'stepRise'>): PathPoint[] {
  return centerlineOf(walkOf(interior, choice, connectorContext(interior, { ...opts, colorOf: () => [0, 0, 0] })))
}

function centerlineOf({ pieces }: Walk): PathPoint[] {
  const first = pieces[0]!
  const out: PathPoint[] = [{ p: first.a, level: first.kind === 'flat' ? first.level : first.fromLevel }]
  for (const piece of pieces) out.push({ p: piece.b, level: piece.kind === 'flat' ? piece.level : piece.toLevel })
  return out
}

type MarkerOptions = Pick<ExitPathOptions, 'yScale' | 'railDrop' | 'boardHalfM'>

/** A marker: the stretch of the track `boardHalfM` either side of the point (kept on the track), and its drawn rail height. */
function markerSpan(interior: StationInterior, at: TrackAt, opts: MarkerOptions): { marker: LocalPoint[]; railY: number } {
  const total = nearestOnPolyline(at.track, at.track[0]!).total
  const length = Math.min(2 * opts.boardHalfM, total)
  const from = Math.max(0, Math.min(at.along - length / 2, total - length))
  return { marker: slicePolyline(at.track, from, from + length), railY: (interior.levels[at.level]!.y - opts.railDrop) * opts.yScale }
}

/**
 * The path's points as drawn, group-local, from one walk: its markers' ends at their rail height (the board marker's,
 * then a transfer's second) and its centerline (exitPathCenterline). Throws when the choice doesn't fit the interior.
 */
export function stationPathPoints(
  interior: StationInterior,
  choice: StationPathChoice,
  opts: MarkerOptions & Pick<ExitPathOptions, 'stepRise'>,
): { markers: Vec3[]; line: Vec3[] } {
  const walk = walkOf(interior, choice, connectorContext(interior, { yScale: opts.yScale, stepRise: opts.stepRise, colorOf: () => [0, 0, 0] }))
  const markers = [walk.start, ...(walk.end ? [walk.end] : [])].flatMap((at) => {
    const { marker, railY } = markerSpan(interior, at, opts)
    return [marker[0]!, marker.at(-1)!].map((p): Vec3 => [p[0], railY, p[1]])
  })
  return { markers, line: centerlineOf(walk).map((q) => q.p) }
}

/**
 * The station path, one layer per stroke band: the centerline (dashed when `dashInStation`), the board marker (the
 * stretch of track at rail height where the rider is assumed to stand in the train, `boardHalfM` either side of the
 * start), with `restroke` each connector taken. An exit or a way in adds its entrance square (with `restroke`); a
 * transfer adds the same marker on the next train's track where the path meets it. Throws when the choice doesn't fit the interior.
 */
export function exitPathBuffers(interior: StationInterior, choice: StationPathChoice, opts: ExitPathOptions): ExitPathLayers {
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

  // A marker: the stretch of track at rail height around the point (kept on the track); returns its ends and middle.
  const markerAt = (at: TrackAt): Vec3[] => {
    const { marker, railY } = markerSpan(interior, at, opts)
    for (let i = 1; i < marker.length; i++) {
      const [p, q] = [marker[i - 1]!, marker[i]!]
      levelSink(at.level).segment([p[0], railY, p[1]], [q[0], railY, q[1]], rgb, rgb, dash)
    }
    return [marker[0]!, marker[Math.floor(marker.length / 2)]!, marker.at(-1)!].map((p): Vec3 => [p[0], railY, p[1]])
  }
  const startKeep = markerAt(walk.start)
  const endKeep = walk.end ? markerAt(walk.end) : []

  if (opts.restroke) {
    // A walkway dashes like the interior's: on an estimated layout, or between two approximate slabs.
    const rough = new Set(interior.slabs.filter((k) => k.approximate === true).map((k) => k.id))
    for (const piece of walk.pieces) {
      if (piece.kind !== 'connector') continue
      const ends = [piece.c.lower.area, piece.c.upper.area]
      const walkwayDashed = interior.generated !== undefined || ends.every((a) => a !== undefined && rough.has(a))
      if (restroke(ctx, piece.c, piece.lower, piece.upper, sinks, walkwayDashed)) dashed = true
    }
    const entranceId = choice.kind === 'transfer' ? null : choice.exit.entranceId
    const e = entranceId === null ? undefined : interior.entrances.find((k) => k.id === entranceId)
    if (e) {
      const h = (opts.entranceSize + 1) / 2
      const square: LocalPoint[] = [[e.x - h, e.z - h], [e.x + h, e.z - h], [e.x + h, e.z + h], [e.x - h, e.z + h]]
      levelSink(street).loop(square, ctx.realY(street) * yScale, rgb)
    }
  }

  // What the level labels keep clear of: the path's first point, the first connector's foot and the markers.
  const firstConnector = walk.pieces.find((p) => p.kind === 'connector')
  const keep: Vec3[] = [walk.pieces[0]!.a, ...(firstConnector ? [firstConnector.a] : []), ...startKeep, ...endKeep]
  return { bands: sinks.writers.map((w) => w.build()), dashed, keepOut: new Float32Array(keep.flat()) }
}
