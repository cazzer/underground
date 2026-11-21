/** public/data → render model: projected stations, routes, and shape paths. Pure. */
import type { AdaStatus, Borough, Direction, RouteId, RoutesFile, ShapeId, ShapesFile, StationId, StationsFile, StopId } from '../data/schema'
import { decodeStationDepths } from '../data/depthsCodec'
import type { PackedDepthsFile } from '../data/stationSchema'
import { NO_BANDS, type CorridorShape, type ShapeBands } from './corridors'
import { boundsCenter } from './framing'
import { vertexBandInputs } from './lineBuffers'
import { toGround, type Ground } from './projection'
import { platformSpans, type PlatformSpan } from './platformSpan'
import { buildPolyline, type Polyline } from './realtime/polyline'
import { profileRuns } from './trackAnchors'
import { trackLine } from './trackLine'
import { lineBreaks } from './trackBreaks'
import { buildTrackProfile, EMPTY_PROFILE, GRADE, profileAt, resampleAt, type ProfileRun, type TrackProfile } from './trackProfile'

export interface Station {
  id: StationId
  name: string
  pos: Ground
  /** In route_sort_order. */
  routeIds: readonly RouteId[]
  /** Child stop ids (one per platform direction), sorted. */
  stops: readonly StopId[]
  /** Undefined when an older cached stations.json predates the field. */
  borough?: Borough
  access: StationAccessInfo
}

/** ADA status; `note` is the MTA's direction text for a partly accessible station ("Downtown only"). */
export interface StationAccessInfo {
  status: AdaStatus
  note?: string
}

/** A file without `ada` (an older cached build) or with an unknown value reads as not accessible: no false badge. */
export function stationAccess(s: Partial<Pick<StationsFile['stations'][number], 'ada' | 'adaPartial'>>): StationAccessInfo {
  if (s.ada === 'full') return { status: 'full' }
  if (s.ada === 'partial') return s.adaPartial?.note ? { status: 'partial', note: s.adaPartial.note } : { status: 'partial' }
  return { status: 'none' }
}

export interface Route {
  id: RouteId
  shortName: string
  longName: string
  /** '#RRGGBB' as published in GTFS; pass through `routeLineColor` before drawing. */
  color: string
}

export interface ShapePath {
  id: ShapeId
  routeId: RouteId
  direction: Direction
  primary: boolean
  /**
   * `trackLine`: spurs dropped, `trackOffsetM` right of travel, so the directions are parallel tracks; then
   * resampled along the profile's ramps and the band's tapers (collinear points, the ground path is unchanged).
   */
  points: Ground[]
  /** Cumulative distance (meters) at each point; last entry is the total length. */
  cumulative: number[]
  length: number
  /** Scene height of each point: profileAt(profile, cumulative[i]). */
  y: number[]
  /** Shared with the realtime geometry, so trains ride the drawn track up and down. */
  profile: TrackProfile
  /** The band offset's inputs at each point (lineBuffers.ts vertexBandInputs): miter, slot and half-width there. */
  bandInputs: Float32Array
  /** The shape's bands along its distance (corridors.ts); NO_BANDS when it shares no corridor or before bandShapes. */
  bands: ShapeBands
}

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface Network {
  feedVersion: string
  /** Sorted by id. */
  stations: readonly Station[]
  stationById: ReadonlyMap<StationId, Station>
  /** In route_sort_order. */
  routes: readonly Route[]
  routeById: ReadonlyMap<RouteId, Route>
  /** Without bands (NO_BANDS): the first paint draws these while networkBands.ts finds the corridors. */
  shapes: readonly ShapePath[]
  shapeById: ReadonlyMap<ShapeId, ShapePath>
  /** Each shape's track line before resampling, in `shapes` order: the corridor search's input. */
  trackLines: readonly CorridorShape[]
  /** Covers every station and every shape point. */
  bounds: Bounds
  center: Ground
  /** How far each shape sits right of travel; realtime geometry reads it here (never from the URL). */
  trackOffsetM: number
  /** Vertical profile of each shape anchored at a station depth (others are flat at 0); realtime reads it here. */
  profiles: ReadonlyMap<ShapeId, TrackProfile>
  /** Scene height of the deepest ridden platform track at each station with a depth (rail y x yScale). */
  stationTrackY: ReadonlyMap<StationId, number>
  /** Per station with a depth, where each shape riding its platform tracks runs along them (the profile's kept runs). */
  platformSpans: ReadonlyMap<StationId, ReadonlyMap<ShapeId, PlatformSpan>>
}

function extend(b: Bounds, p: Ground): void {
  if (p.x < b.minX) b.minX = p.x
  if (p.x > b.maxX) b.maxX = p.x
  if (p.z < b.minZ) b.minZ = p.z
  if (p.z > b.maxZ) b.maxZ = p.z
}

/**
 * A shape's drawn path: `line` resampled along its profile's ramps, its platform spans' fade and its bands'
 * tapers (trackBreaks.ts), with each point's height and band inputs.
 */
export function drawnPath(
  meta: Pick<ShapePath, 'id' | 'routeId' | 'direction' | 'primary'>,
  line: Polyline,
  profile: TrackProfile,
  bands: ShapeBands,
  spans: ReadonlyMap<StationId, ReadonlyMap<ShapeId, PlatformSpan>>,
): ShapePath {
  const { points, cumulative } = resampleAt(line.points, line.cumulative, lineBreaks(profile, bands, spans, meta.id))
  const bandInputs = vertexBandInputs(
    points,
    cumulative.map((d) => profileAt(bands.slot, d)),
    cumulative.map((d) => profileAt(bands.half, d)),
  )
  return {
    id: meta.id,
    routeId: meta.routeId,
    direction: meta.direction,
    primary: meta.primary,
    points,
    cumulative,
    length: cumulative.at(-1)!,
    y: cumulative.map((d) => profileAt(profile, d)),
    profile,
    bandInputs,
    bands,
  }
}

/**
 * `trackOffsetM` moves every shape that far right of its own travel direction (see trackLine.ts). Each shape
 * that stops at a station in `depths` descends to that station's rails (y scaled by `yScale`, the interior's
 * vertical exaggeration); the rest stay at 0. Shapes come without bands: networkBands.ts adds them later, off
 * the first paint. `depths` is decoded against these stations and drawn lines (depthsCodec.ts). Warns, in one
 * line, about packed tracks no shape rides.
 */
export function buildNetwork(
  stationsFile: StationsFile,
  routesFile: RoutesFile,
  shapesFile: ShapesFile,
  trackOffsetM: number,
  depths: PackedDepthsFile,
  yScale: number,
): Network {
  const { feedVersion } = stationsFile
  for (const f of [routesFile, shapesFile]) {
    if (f.feedVersion !== feedVersion) {
      throw new Error(`Data files are from different builds: "${feedVersion}" vs "${f.feedVersion}"`)
    }
  }
  if (stationsFile.stations.length === 0) throw new Error('stations.json has no stations')

  const routes = routesFile.routes.map(
    (r): Route => ({ id: r.id, shortName: r.shortName, longName: r.longName, color: `#${r.color}` }),
  )
  const routeById = new Map(routes.map((r) => [r.id, r]))

  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const stations = stationsFile.stations.map((s): Station => {
    const pos = toGround(s)
    extend(bounds, pos)
    return { id: s.id, name: s.name, pos, routeIds: s.routes, stops: s.stops, borough: s.borough, access: stationAccess(s) }
  })

  const lines = shapesFile.shapes.map((s) => {
    if (!routeById.has(s.routeId)) throw new Error(`Shape ${s.id} references unknown route "${s.routeId}"`)
    const points = trackLine(s, trackOffsetM)
    if (points.length < 2) throw new Error(`Shape ${s.id} has ${points.length} point(s); needs at least 2`)
    return { id: s.id, routeId: s.routeId, direction: s.direction, primary: s.primary, line: buildPolyline(points) }
  })
  const decoded = decodeStationDepths(depths, stationsFile.stations, lines)
  const { runs, unmatched } = profileRuns(decoded.depths, stations, lines)
  // The build packs only tracks a shape rides and prints the rest (npm run data:stations), so this stays quiet
  // unless the files are out of step; then it is one line, not one per track.
  const offLine = [...decoded.missed, ...unmatched]
  if (offLine.length > 0) console.warn(`Track depth: no shape rides ${offLine.length} platform track(s); they stay at street level:`, offLine)

  const profiles = new Map<ShapeId, TrackProfile>()
  const stationTrackY = new Map<StationId, number>()
  const keptRuns: [ShapeId, ProfileRun[]][] = []
  const shapes = shapesFile.shapes.map((s, i): ShapePath => {
    const { line } = lines[i]!
    const built = buildTrackProfile(runs.get(s.id) ?? [], { grade: GRADE, yScale })
    if (built.dropped.length > 0) console.warn(`Track depth: shape ${s.id} has overlapping platform runs; dropped`, built.dropped)
    for (const { from, to, grade } of built.steep) {
      console.warn(`Track depth: shape ${s.id} eases ${from.yReal} m to ${to.yReal} m at a ${(grade * 100).toFixed(1)}% grade`)
    }
    const profile = built.profile
    // Only runs the profile kept: a dropped (overlapping) run's station isn't drawn at depth on this shape.
    if (built.kept.length > 0) keptRuns.push([s.id, built.kept])
    for (const run of built.kept) {
      if (run.stationId === undefined) continue
      const y = run.yReal * yScale
      const deepest = stationTrackY.get(run.stationId)
      stationTrackY.set(run.stationId, deepest === undefined ? y : Math.min(deepest, y))
    }
    if (profile !== EMPTY_PROFILE) profiles.set(s.id, profile)
    const path = drawnPath(s, line, profile, NO_BANDS, platformSpans([[s.id, built.kept]]))
    // Resampled points are collinear, so bands (which only resample) never move the bounds.
    for (const p of path.points) extend(bounds, p)
    return path
  })

  return {
    feedVersion,
    stations,
    stationById: new Map(stations.map((s) => [s.id, s])),
    routes,
    routeById,
    shapes,
    shapeById: new Map(shapes.map((s) => [s.id, s])),
    trackLines: lines,
    bounds,
    center: boundsCenter(bounds),
    trackOffsetM,
    profiles,
    stationTrackY,
    platformSpans: platformSpans(keptRuns),
  }
}

/**
 * Position at `distance` meters along the path, clamped to its ends. Writes into `out`
 * (pass one to avoid allocating per call) and returns it.
 */
export function pointAlong(path: ShapePath, distance: number, out: Ground = { x: 0, z: 0 }): Ground {
  const first = path.points[0]
  if (!first) throw new Error(`Shape ${path.id} has no points`)
  if (path.points.length === 1) {
    out.x = first.x
    out.z = first.z
    return out
  }
  const d = Math.min(Math.max(distance, 0), path.length)
  let i = 1
  while (i < path.cumulative.length - 1 && path.cumulative[i]! < d) i++
  const a = path.points[i - 1]!
  const b = path.points[i]!
  const span = path.cumulative[i]! - path.cumulative[i - 1]!
  const t = span === 0 ? 0 : (d - path.cumulative[i - 1]!) / span
  out.x = a.x + (b.x - a.x) * t
  out.z = a.z + (b.z - a.z) * t
  return out
}
