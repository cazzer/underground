/** Platform tracks: which platform edge is northbound, and the centerline each one draws. Pure.
 *  The two outermost platform-edge tracks get the station's N and S stops; the direction comes from the data
 *  (both assignments are tried and the one whose ends lie nearer the map's own direction lines wins), not from
 *  right-hand running. Express tracks with no platform edge have no stop and are not drawn. */
import type { Direction, Shape, Station, StationId } from '../../../src/data/schema.ts'
import type { LocalPoint } from '../../../src/data/stationSchema.ts'
import { toGround } from '../../../src/lib/projection.ts'
import { trackLine } from '../../../src/lib/trackLine.ts'
import { TRACK_OFFSET_M } from '../../../src/lib/trackOffset.ts'
import type { OsmCatalogWay } from '../catalogTypes.ts'
import { distanceToSegment, roundM } from '../stationGeometry.ts'
import type { FramePoint } from '../stationInputs.ts'
import type { PlatformGeom, TemplateCtx } from './context.ts'

/** Map line segments kept per station: this close to the station point. */
export const MAP_LINE_RADIUS_M = 600
/** A track path keeps only the stretch this close to its direction's map line (trackAnchors' MATCH_TOL_M). */
export const NEAR_MAP_LINE_M = 6
/** A clipped OSM stretch shorter than this falls back to a straight line at the edge's offset. */
const MIN_PATH_M = 20
const SAMPLE_M = 1

type Seg = [LocalPoint, LocalPoint]
/** Per station, the drawn track lines (trackLine, citywide scene meters) of the routes serving it, by direction. */
export type MapTrackLines = Map<StationId, Record<Direction, Seg[]>>

export function mapTrackLines(shapes: readonly Shape[], stations: readonly Station[]): MapTrackLines {
  const lines = shapes.map((s) => ({ routeId: s.routeId, direction: s.direction, pts: trackLine(s, TRACK_OFFSET_M).map((g): LocalPoint => [g.x, g.z]) }))
  const out: MapTrackLines = new Map()
  for (const st of stations) {
    const g = toGround(st)
    const p: LocalPoint = [g.x, g.z]
    const routes = new Set(st.routes)
    const byDir: Record<Direction, Seg[]> = { N: [], S: [] }
    for (const l of lines) {
      if (!routes.has(l.routeId)) continue
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1]!
        const b = l.pts[i]!
        if (distanceToSegment(p, a, b) <= MAP_LINE_RADIUS_M) byDir[l.direction].push([a, b])
      }
    }
    out.set(st.id, byDir)
  }
  return out
}

function distToLines(p: LocalPoint, segs: readonly Seg[]): number {
  let best = Infinity
  for (const [a, b] of segs) best = Math.min(best, distanceToSegment(p, a, b))
  return best
}

export interface TrackPlan {
  platform: PlatformGeom
  stopId: string
  path: FramePoint[]
  /** Set when the path is a straight estimate rather than the OSM way. */
  note?: string
}

interface Edge {
  platform: PlatformGeom
  offsetV: number
  trackRef: string
}

/** Samples every SAMPLE_M along the polyline, flagging the original vertices. */
function samples(pts: FramePoint[]): { p: FramePoint; vertex: boolean }[] {
  const out: { p: FramePoint; vertex: boolean }[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_M))
    for (let k = 0; k < n; k++) out.push({ p: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], vertex: k === 0 })
  }
  if (pts.length > 0) out.push({ p: pts[pts.length - 1]!, vertex: true })
  return out
}

/** The longest run of the OSM way inside the platform's u-range and near the map line, as its run ends plus the
 *  way's own vertices between them; null when no run reaches MIN_PATH_M. */
function osmPath(ctx: TemplateCtx, way: OsmCatalogWay, e: Edge, segs: readonly Seg[]): FramePoint[] | null {
  const [u0, u1] = e.platform.uRange
  const pts = way.points.map(([lat, lon]) => ctx.uv(lat, lon))
  const s = samples(pts)
  const ok = s.map(({ p }) => {
    if (p[0] < u0 || p[0] > u1) return false
    const w = ctx.world(p)
    return distToLines([w.x, w.z], segs) <= NEAR_MAP_LINE_M
  })
  let best: [number, number] | null = null
  for (let i = 0; i < s.length; i++) {
    if (!ok[i]) continue
    let j = i
    while (j + 1 < s.length && ok[j + 1]) j++
    if (!best || j - i > best[1] - best[0]) best = [i, j]
    i = j
  }
  if (!best || (best[1] - best[0]) * SAMPLE_M < MIN_PATH_M) return null
  const run = s.slice(best[0], best[1] + 1)
  const path = run.filter((x, k) => k === 0 || k === run.length - 1 || x.vertex).map((x): FramePoint => [roundM(x.p[0]), roundM(x.p[1])])
  return path[0]![0] <= path[path.length - 1]![0] ? path : path.reverse()
}

function straight(e: Edge): FramePoint[] {
  return [
    [roundM(e.platform.uRange[0]), roundM(e.offsetV)],
    [roundM(e.platform.uRange[1]), roundM(e.offsetV)],
  ]
}

/** Track centerlines for the two outermost platform-edge tracks, N and S. Throws when the station has fewer
 *  than two platform-edge tracks or no map line for a direction. `swapped` says the N track has the larger v. */
export function assignTracks(ctx: TemplateCtx, lines: MapTrackLines, trackWays: ReadonlyMap<string, OsmCatalogWay>): { tracks: TrackPlan[]; swapped: boolean } {
  const edges: Edge[] = ctx.platforms.flatMap((platform) => platform.edges.map((e) => ({ platform, offsetV: e.offsetV, trackRef: e.trackRef })))
  if (edges.length < 2) throw new Error(`${edges.length} platform-edge track(s); need two`)
  const sorted = [...edges].sort((a, b) => a.offsetV - b.offsetV)
  const lo = sorted[0]!
  const hi = sorted[sorted.length - 1]!
  if (hi.offsetV - lo.offsetV < 2) throw new Error('the outermost platform-edge tracks are less than 2 m apart')
  const map = lines.get(ctx.stationId)
  if (!map || map.N.length === 0 || map.S.length === 0) throw new Error('no map track line near the station for one direction')
  const cost = (e: Edge, dir: Direction): number =>
    straight(e).reduce((sum, p) => {
      const w = ctx.world(p)
      return sum + distToLines([w.x, w.z], map[dir])
    }, 0)
  const swapped = cost(lo, 'S') + cost(hi, 'N') < cost(lo, 'N') + cost(hi, 'S')
  const plan = (e: Edge, dir: Direction): TrackPlan => {
    const stopId = `${ctx.stationId}${dir}`
    const way = e.trackRef === 'estimated' ? undefined : trackWays.get(e.trackRef)
    const path = way ? osmPath(ctx, way, e, map[dir]) : null
    if (path) return { platform: e.platform, stopId, path }
    const why = way ? `OSM way ${e.trackRef} is not within ${NEAR_MAP_LINE_M} m of the map's ${dir} line for ${MIN_PATH_M} m` : `no OSM way (${e.trackRef})`
    return { platform: e.platform, stopId, path: straight(e), note: `${stopId}: straight track at v ${e.offsetV.toFixed(1)} m: ${why}` }
  }
  return { tracks: swapped ? [plan(hi, 'N'), plan(lo, 'S')] : [plan(lo, 'N'), plan(hi, 'S')], swapped }
}
