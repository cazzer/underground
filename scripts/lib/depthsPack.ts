/**
 * The per-track station depths (stationDepths.ts) packed into public/data/station-depths.json (`PackedDepthsFile`):
 * per station a rail height and its tracks' runs along the drawn lines, and an override for a track the columns
 * don't reproduce. Every track is checked by decoding it (src/data/depthsCodec.ts) and comparing the runs
 * `profileRuns` finds with the full format's. Pure.
 */
import type { Shape, StopId } from '../../src/data/schema.ts'
import type { PackedDepthsFile, PackedTrack, StationDepth, StationDepthsFile, TrackDepth } from '../../src/data/stationSchema.ts'
import {
  columnRun, linesByRouteDirection, nearestLine, overrideRun, runTrack, STATION_MATCH_M, stopLines, type DepthsStations, type LineRun,
} from '../../src/data/depthsCodec.ts'
import { toGround, type Ground } from '../../src/lib/projection.ts'
import { buildPolyline, pointAtDistance, projectForward } from '../../src/lib/realtime/polyline.ts'
import { profileRuns, type AnchorShape, type AnchorStation } from '../../src/lib/trackAnchors.ts'
import { trackLine } from '../../src/lib/trackLine.ts'
import type { ProfileRun } from '../../src/lib/trackProfile.ts'
import { toStableJson } from './stableJson.ts'

/** A packed track may move each end of its runs this far along their shapes (meters); past it the track gets an override. */
export const PACK_TOL_M = 2

export interface PackResult {
  file: PackedDepthsFile
  /** Interior tracks no drawn line rides in the full format (profileRuns' `unmatched`): packed as null, so the map
   *  keeps them at street level exactly as before, and the client has nothing to warn about. */
  notRidden: StopId[]
  /** Tracks packed as overrides: the columns miss their runs by more than the tolerance (or their height differs). */
  split: StopId[]
  /** Tracks whose override still misses their runs by more than the tolerance, with the error in meters. */
  inexact: { stopId: StopId; errorM: number }[]
}

/** The file's text: one key per line, each column inline. */
export function renderPackedDepths(file: PackedDepthsFile): string {
  return toStableJson(file, 1)
}

/** The drawn track lines (as network.ts builds them, before profile resampling). */
export function drawnLines(shapes: readonly Shape[], trackOffsetM: number): AnchorShape[] {
  return shapes.map((s) => ({ id: s.id, routeId: s.routeId, direction: s.direction, line: buildPolyline(trackLine(s, trackOffsetM)) }))
}

/**
 * Worst end or height (×10) difference of `got` against every run of `want`; Infinity when a shape of `want` is
 * missing from `got`. Extra shapes in `got` don't count: decoded ends lie on a drawn line, so a sibling shape of the
 * same route that ran just past MATCH_TOL_M of the interior's own track may now ride it too.
 */
export function runError(want: ReadonlyMap<string, ProfileRun>, got: ReadonlyMap<string, ProfileRun>): number {
  let worst = 0
  for (const [id, a] of want) {
    const b = got.get(id)
    if (!b) return Infinity
    worst = Math.max(worst, Math.abs(a.d0 - b.d0), Math.abs(a.d1 - b.d1), Math.abs(a.yReal - b.yReal) * 10)
  }
  return worst
}

const round = Math.round
const START = { segment: 0, t: 0 }

interface TrackPlan {
  track: TrackDepth
  /** Along-line centre from the station point's projection, and half-length, on the line columnRun picks; null if none. */
  along: { a: number; h: number } | null
  override: PackedTrack
  error: (run: LineRun | null, yDm: number) => number
}

/** [y, a, h, da, dh], one station's columns. */
type Column = [y: number, a: number, h: number, da: number, dh: number]
type Along = { a: number; h: number } | null

/** The rounded columns that reproduce the N and S tracks' own runs (either may be null: no column run). */
function exactColumn(y: number, n: Along, s: Along): Column {
  const [a, h] = n ? [round(n.a), round(n.h)] : s ? [-round(s.a), round(s.h)] : [0, 0]
  return s ? [y, a, h, round(s.a) + a, round(s.h) - h] : [y, a, h, 0, 0]
}

/**
 * The column that gzips best and still `fits`: h repeated from the previous station, and da and dh left at 0, when
 * that keeps every kept track within the tolerance. Falls back to the exact column (which fits by construction).
 */
function cheapestColumn(y: number, n: Along, s: Along, prevH: number, fits: (col: Column) => boolean): Column {
  const exact = exactColumn(y, n, s)
  const [, a, ownH] = exact
  const options: { col: Column; cost: number }[] = []
  for (const h of [prevH, ownH]) {
    const da = s ? round(s.a) + a : 0
    const dh = s ? round(s.h) - h : 0
    for (const pickDa of [0, da]) for (const pickDh of [0, dh]) {
      options.push({ col: [y, a, h, pickDa, pickDh], cost: Number(h !== prevH) + Number(pickDa !== 0) + Number(pickDh !== 0) })
    }
  }
  options.sort((p, q) => p.cost - q.cost)
  return options.find((o) => fits(o.col))?.col ?? exact
}

export function packStationDepths(
  full: StationDepthsFile,
  stationsFile: DepthsStations,
  shapes: readonly AnchorShape[],
  tolM: number = PACK_TOL_M,
): PackResult {
  const { stations } = stationsFile
  const indexOf = new Map(stations.map((s, i) => [s.id, i]))
  const anchorStations: AnchorStation[] = stations.map((s) => ({ id: s.id, routeIds: s.routes }))
  const byRoute = linesByRouteDirection(shapes)
  const lineOf = new Map(shapes.map((s) => [s.id, s.line]))
  const runsOf = (depth: StationDepth): Map<string, ProfileRun> => {
    const { runs } = profileRuns({ license: 'ODbL-1.0', attribution: [], stations: [depth] }, anchorStations, shapes)
    return new Map([...runs].map(([id, [run]]) => [id, run!]))
  }
  const notRidden = new Set(profileRuns(full, anchorStations, shapes).unmatched)
  const entries: { index: number; column: Column; overrides: [StopId, PackedTrack | null][] }[] = []
  let prevH = 0
  const split: StopId[] = []
  const inexact: PackResult['inexact'] = []

  for (const depth of full.stations) {
    const index = indexOf.get(depth.stationId)
    if (index === undefined) throw new Error(`${depth.stationId}: has a depth but is not in stations.json`)
    const station = stations[index]!
    const origin = toGround(station)
    for (const t of depth.tracks) {
      if (!station.stops.includes(t.stopId)) throw new Error(`${t.stopId}: not a child stop of ${station.id}`)
      if (!/[NS]$/.test(t.stopId)) throw new Error(`${t.stopId}: a platform track's stop must end in N or S`)
    }
    const ridden = depth.tracks.filter((t) => !notRidden.has(t.stopId))
    if (ridden.length === 0) continue
    const plans = ridden.map((track): TrackPlan => {
      const candidates = stopLines(station, track.stopId, byRoute)
      const want = runsOf({ ...depth, tracks: [track] })
      const ends = track.ends.map(([x, z]): Ground => ({ x: toGround(depth.anchor).x + x, z: toGround(depth.anchor).z + z }))
      const hit = nearestLine(origin, candidates, STATION_MATCH_M)
      const along = hit && ((): { a: number; h: number } => {
        const [p, q] = ends.map((e) => projectForward(hit.line, e, START).distance)
        return { a: (p! + q!) / 2 - hit.distance, h: Math.abs(q! - p!) / 2 }
      })()
      // The override's centre: mid-run on the first line that rides the track.
      const [firstId, first] = [...want][0]!
      const c = pointAtDistance(lineOf.get(firstId)!, (first.d0 + first.d1) / 2).point
      const override: PackedTrack = [round(track.railY * 10), round(c.x - origin.x), round(c.z - origin.z), round((first.d1 - first.d0) / 2)]
      const error = (run: LineRun | null, yDm: number): number =>
        run ? runError(want, runsOf({ ...depth, anchor: station, tracks: [runTrack(track.stopId, yDm, run, origin)] })) : Infinity
      return { track, along, override, error }
    })
    const n = plans.find((p) => p.track.stopId.endsWith('N'))
    const s = plans.find((p) => p.track.stopId.endsWith('S'))
    const y = round((n ?? s)!.track.railY * 10)
    const fits = (p: TrackPlan | undefined, col: Column): boolean => {
      if (!p || p.along === null || round(p.track.railY * 10) !== y) return false
      return p.error(columnRun(p.track.stopId, [col[1], col[2], col[3], col[4]], origin, stopLines(station, p.track.stopId, byRoute)), y) <= tolM
    }
    // Each track's column run depends only on its own values (S: d - a + da = d + round(aS)), so test both kept.
    const exact = exactColumn(y, n?.along ?? null, s?.along ?? null)
    const [keepN, keepS] = [fits(n, exact), fits(s, exact)]
    const column = cheapestColumn(y, keepN ? n!.along : null, keepS ? s!.along : null, prevH, (col) =>
      (!keepN || fits(n, col)) && (!keepS || fits(s, col)),
    )
    prevH = column[2]
    const overrides: [StopId, PackedTrack | null][] = []
    for (const p of plans) {
      if ((p === n && keepN) || (p === s && keepS)) continue
      overrides.push([p.track.stopId, p.override])
      split.push(p.track.stopId)
      const candidates = stopLines(station, p.track.stopId, byRoute)
      const errorM = p.error(overrideRun(p.override, origin, candidates), p.override[0])
      if (errorM > tolM) inexact.push({ stopId: p.track.stopId, errorM })
    }
    for (const stopId of station.stops) if (!ridden.some((t) => t.stopId === stopId)) overrides.push([stopId, null])
    entries.push({ index, column, overrides })
  }

  entries.sort((a, b) => a.index - b.index)
  const tracks: Record<StopId, PackedTrack | null> = {}
  for (const e of entries) for (const [stopId, v] of e.overrides.sort(([a], [b]) => (a < b ? -1 : 1))) tracks[stopId] = v
  const col = (i: number): number[] => entries.map((e) => e.column[i]!)
  const file: PackedDepthsFile = {
    license: full.license,
    attribution: full.attribution,
    format: 2,
    feedVersion: stationsFile.feedVersion,
    station: entries.map((e, k) => (k === 0 ? e.index : e.index - entries[k - 1]!.index)),
    y: col(0),
    a: col(1),
    h: col(2),
    da: col(3),
    dh: col(4),
    tracks,
  }
  return { file, notRidden: [...notRidden].sort(), split: split.sort(), inexact }
}

