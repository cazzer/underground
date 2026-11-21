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

/** The stations.json the file was packed against: its build and its stations, in order. */
export interface DepthsStations {
  feedVersion: string
  stations: readonly DepthsStation[]
}

const fail = (why: string): Error => new Error(`station-depths: ${why}`)

/** Throws on a malformed file: columns of different lengths or with a non-number, a bad index or delta, a bad override. */
function checkShape(file: PackedDepthsFile, count: number): void {
  const n = file.station.length
  for (const key of COLUMNS) {
    if (file[key].length !== n) throw fail(`column ${key} has ${file[key].length} entries, not ${n}`)
    const bad = file[key].findIndex((v) => typeof v !== 'number' || !Number.isFinite(v))
    if (bad >= 0) throw fail(`column ${key} entry ${bad} is not a number`)
  }
  let index = -1
  file.station.forEach((d, k) => {
    if (!Number.isInteger(d)) throw fail(`station entry ${k} is not an integer`)
    if (k === 0 ? d < 0 : d < 1) throw fail(k === 0 ? `first station index ${d} is negative` : `station delta ${d} at entry ${k} is below 1`)
    index = k === 0 ? d : index + d
    if (index >= count) throw fail(`station index ${index} is outside stations.json (${count} stations)`)
  })
  for (const [stopId, v] of Object.entries(file.tracks)) {
    if (v === null) continue
    if (!Array.isArray(v) || v.length !== 4 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      throw fail(`override ${stopId} is not four numbers`)
    }
  }
}

/**
 * Throws on a malformed file (see checkShape, and an override of no listed station). A file packed against another
 * stations.json (its feedVersion differs: a stale or mixed deploy) logs one error and decodes to no depths, so the
 * tracks stay at street level and the map still loads.
 */
export function decodeStationDepths(file: PackedDepthsFile, stationsFile: DepthsStations, shapes: readonly AnchorShape[]): DecodedDepths {
  const { stations } = stationsFile
  if (file.feedVersion !== stationsFile.feedVersion) {
    console.error(
      `station-depths.json was packed for feed ${JSON.stringify(file.feedVersion)}, not stations.json's ${JSON.stringify(stationsFile.feedVersion)}; tracks stay at street level`,
    )
    return { depths: { license: file.license, attribution: file.attribution, stations: [] }, missed: [] }
  }
  checkShape(file, stations.length)
  const n = file.station.length
  const byRoute = linesByRouteDirection(shapes)
  const used = new Set<StopId>()
  const missed: StopId[] = []
  const out: StationDepth[] = []
  let index = -1
  for (let k = 0; k < n; k++) {
    index = k === 0 ? file.station[0]! : index + file.station[k]!
    const station = stations[index]!
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
  if (stray.length > 0) throw fail(`overrides for stops of no listed station: ${stray.join(', ')}`)
  return { depths: { license: file.license, attribution: file.attribution, stations: out }, missed }
}
