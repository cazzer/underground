/**
 * public/data/station-depths.json (`PackedDepthsFile`) to the per-track `StationDepthsFile` that trackAnchors.ts
 * `profileRuns` reads. A track's candidate lines are the drawn lines of the routes serving its station in its stop
 * suffix's direction (as profileRuns matches them). From the columns, the station point is projected onto the nearest
 * candidate (within STATION_MATCH_M) and the run is laid along that line; an override's centre is projected onto the
 * nearest candidate within CENTRE_MATCH_M. The track's ends are the points at the run's two distances. Pure.
 * Explicit `.ts` imports because scripts/lib/depthsPack.ts (the encoder) runs it in Node.
 */
import type { AnchorShape } from '../lib/trackAnchors.ts'
import { toGround, type Ground } from '../lib/projection.ts'
import { pointAtDistance, projectForward, type Polyline } from '../lib/realtime/polyline.ts'
import type { Station, StopId } from './schema.ts'
import type { PackedDepthsFile, PackedTrack, StationDepth, StationDepthsFile, TrackDepth } from './stationSchema.ts'

/** An override's centre this close to a drawn line of its direction decodes onto it. */
export const CENTRE_MATCH_M = 15
/** The station point this close to a drawn line of a direction lays that direction's column run on it. */
export const STATION_MATCH_M = 150

export type DepthsStation = Pick<Station, 'id' | 'lat' | 'lon' | 'routes' | 'stops'>

export interface DecodedDepths {
  depths: StationDepthsFile
  /** Child stops with packed values but no candidate line in reach. */
  missed: StopId[]
}

/** A track run along one line: centre distance and half-length. */
export interface LineRun {
  line: Polyline
  d: number
  h: number
}

const START = { segment: 0, t: 0 }

/** The line of `candidates` nearest `p` (ties to the first), with the projected distance, or null past `maxM`. */
export function nearestLine(p: Ground, candidates: readonly Polyline[], maxM: number): { line: Polyline; distance: number } | null {
  let best: { line: Polyline; distance: number; offsetM: number } | null = null
  for (const line of candidates) {
    const hit = projectForward(line, p, START)
    if (hit.offsetM <= maxM && (!best || hit.offsetM < best.offsetM)) best = { line, distance: hit.distance, offsetM: hit.offsetM }
  }
  return best && { line: best.line, distance: best.distance }
}

/** Lines per route and direction ("L N"), in `shapes` order. */
export function linesByRouteDirection(shapes: readonly AnchorShape[]): Map<string, Polyline[]> {
  const out = new Map<string, Polyline[]>()
  for (const s of shapes) {
    const key = `${s.routeId} ${s.direction}`
    const list = out.get(key)
    if (list) list.push(s.line)
    else out.set(key, [s.line])
  }
  return out
}

/** The candidate lines for a child stop: every route serving its station, in the stop's direction. */
export function stopLines(station: DepthsStation, stopId: StopId, byRoute: ReadonlyMap<string, readonly Polyline[]>): Polyline[] {
  const direction = stopId.at(-1)
  return station.routes.flatMap((r) => byRoute.get(`${r} ${direction}`) ?? [])
}

/** The run of a stop from its station's columns (null when no candidate is near the station point or the suffix isn't N/S). */
export function columnRun(stopId: StopId, cols: readonly [a: number, h: number, da: number, dh: number], origin: Ground, candidates: readonly Polyline[]): LineRun | null {
  const [a, h, da, dh] = cols
  const direction = stopId.at(-1)
  if (direction !== 'N' && direction !== 'S') return null
  const hit = nearestLine(origin, candidates, STATION_MATCH_M)
  if (!hit) return null
  return direction === 'N' ? { line: hit.line, d: hit.distance + a, h } : { line: hit.line, d: hit.distance - a + da, h: h + dh }
}

/** The run of an override (null when no candidate is near its centre). */
export function overrideRun(values: PackedTrack, origin: Ground, candidates: readonly Polyline[]): LineRun | null {
  const [, x, z, h] = values
  const hit = nearestLine({ x: origin.x + x, z: origin.z + z }, candidates, CENTRE_MATCH_M)
  return hit && { line: hit.line, d: hit.distance, h }
}

/** A run to its track depth, ends station-local to `origin`. */
export function runTrack(stopId: StopId, yDm: number, run: LineRun, origin: Ground): TrackDepth {
  const [p, q] = [run.d - run.h, run.d + run.h].map((d) => pointAtDistance(run.line, d).point)
  return { stopId, railY: yDm / 10, ends: [[p!.x - origin.x, p!.z - origin.z], [q!.x - origin.x, q!.z - origin.z]] }
}

const COLUMNS = ['y', 'a', 'h', 'da', 'dh'] as const

/** Throws on a file that doesn't fit `stations` (columns of different lengths, an index out of range, a stray override). */
export function decodeStationDepths(
  file: PackedDepthsFile,
  stations: readonly DepthsStation[],
  shapes: readonly AnchorShape[],
): DecodedDepths {
  const n = file.station.length
  for (const key of COLUMNS) {
    if (file[key].length !== n) throw new Error(`station-depths: column ${key} has ${file[key].length} entries, not ${n}`)
  }
  const byRoute = linesByRouteDirection(shapes)
  const used = new Set<StopId>()
  const missed: StopId[] = []
  const out: StationDepth[] = []
  let index = -1
  for (let k = 0; k < n; k++) {
    index = k === 0 ? file.station[0]! : index + file.station[k]!
    const station = stations[index]
    if (!station) throw new Error(`station-depths: station index ${index} is outside stations.json`)
    const origin = toGround(station)
    const cols = [file.a[k]!, file.h[k]!, file.da[k]!, file.dh[k]!] as const
    const tracks: TrackDepth[] = []
    for (const stopId of station.stops) {
      const candidates = stopLines(station, stopId, byRoute)
      const override = Object.hasOwn(file.tracks, stopId) ? file.tracks[stopId]! : undefined
      if (override !== undefined) used.add(stopId)
      if (override === null) continue
      const run = override ? overrideRun(override, origin, candidates) : columnRun(stopId, cols, origin, candidates)
      if (run) tracks.push(runTrack(stopId, override ? override[0] : file.y[k]!, run, origin))
      else missed.push(stopId)
    }
    out.push({ stationId: station.id, anchor: { lat: station.lat, lon: station.lon }, tracks })
  }
  const stray = Object.keys(file.tracks).filter((s) => !used.has(s))
  if (stray.length > 0) throw new Error(`station-depths: overrides for stops of no listed station: ${stray.join(', ')}`)
  return { depths: { license: file.license, attribution: file.attribution, stations: out }, missed }
}
