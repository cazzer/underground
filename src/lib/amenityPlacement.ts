/**
 * Where a station's amenity marks (StationAmenities.tsx, enp.5) lie on the ground: in a row along one "clear bearing"
 * per station, the compass direction (north preferred) whose plates keep farthest from the drawn tracks and the other
 * station markers, starting just past the station's marker, or past a shown interior's footprint. Pure; everything
 * here runs once per layout except `markCentre`, which allocates nothing.
 */
import type { AmenitiesFile } from '../data/amenitiesSchema'
import { groupAmenities, type AmenityKind } from './amenityGlyphs'
import type { Footprint } from './interiorFootprint'
import type { Ground } from './projection'
import { distinctTracks } from './routeTracks'

/** Only tracks and stations this close to the station are scored (no plate reaches past it). */
export const NEAR_M = 80
/** A bearing within this of the best score (at most half the best) counts as clear, so the preferred one wins near-ties. */
export const TIE_M = 3
/** Another station's marker counts as a track this much nearer (its radius at street zoom, MARKER_MIN_METERS). */
export const STATION_PAD_M = 6

/** A plate a bearing is scored by: a north-up square centred `along` meters out on the bearing, of half size `half`. */
export interface PlateProbe {
  along: number
  half: number
}

/** The compass bearings in order of preference: north first (screen-up at the default azimuth, clear of a phone's
 *  panel and of the levels hanging below an interior at tilt), then its neighbours, south last, then the eight
 *  half-winds clockwise from north. Unit x (east), z (south). */
const S = Math.SQRT1_2
export const BEARINGS: readonly Ground[] = [
  { x: 0, z: -1 },
  { x: S, z: -S },
  { x: -S, z: -S },
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: S, z: S },
  { x: -S, z: S },
  { x: 0, z: 1 },
  // The half-winds win only by more than the tie slack: a crowded junction where none of the eight is clear.
  ...[1, 3, 5, 7, 9, 11, 13, 15].map((k) => ({ x: Math.sin((k * Math.PI) / 8), z: -Math.cos((k * Math.PI) / 8) })),
]

/** One mark: a kind at a station lead, the k-th in its station's row along `dir`. */
export interface AmenityMark {
  /** The station group's lead id. */
  stationId: string
  /** Every member of the group (a shown interior covering any of them moves the mark). */
  memberIds: readonly string[]
  kind: AmenityKind
  /** Its place in the row: 0 nearest the station. */
  k: number
  /** The lead's ground point. */
  pos: Ground
  /** The clear bearing, unit length. */
  dir: Ground
}

interface StationLike {
  id: string
  pos: Ground
  memberIds: readonly string[]
}

/** Every track segment as x0, z0, x1, z1, once per distinct ground path. */
export function trackSegments(shapes: readonly { points: readonly Ground[] }[]): Float32Array {
  const tracks = distinctTracks(shapes)
  let n = 0
  for (const t of tracks) n += Math.max(t.points.length - 1, 0)
  const out = new Float32Array(n * 4)
  let o = 0
  for (const { points } of tracks) {
    for (let i = 1; i < points.length; i++) {
      out[o++] = points[i - 1]!.x
      out[o++] = points[i - 1]!.z
      out[o++] = points[i]!.x
      out[o++] = points[i]!.z
    }
  }
  return out
}

function pointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 > 0 ? Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / len2, 0), 1) : 0
  return Math.hypot(px - ax - t * dx, pz - az - t * dz)
}

const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax)

/** The distance between segments ab and cd in the plane: 0 when they cross. */
export function segmentDistance(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const d1 = cross(ax, az, bx, bz, cx, cz)
  const d2 = cross(ax, az, bx, bz, dx, dz)
  const d3 = cross(cx, cz, dx, dz, ax, az)
  const d4 = cross(cx, cz, dx, dz, bx, bz)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(
    pointSegment(ax, az, cx, cz, dx, dz),
    pointSegment(bx, bz, cx, cz, dx, dz),
    pointSegment(cx, cz, ax, az, bx, bz),
    pointSegment(dx, dz, ax, az, bx, bz),
  )
}

/** The distance from segment (x0, z0)-(x1, z1) to the axis-aligned square of half size `h` centred at (cx, cz): 0 when they touch. */
export function squareDistance(x0: number, z0: number, x1: number, z1: number, cx: number, cz: number, h: number): number {
  const a = x0 - cx
  const b = z0 - cz
  const c = x1 - cx
  const d = z1 - cz
  if ((Math.abs(a) <= h && Math.abs(b) <= h) || (Math.abs(c) <= h && Math.abs(d) <= h)) return 0
  return Math.min(
    segmentDistance(-h, -h, h, -h, a, b, c, d),
    segmentDistance(h, -h, h, h, a, b, c, d),
    segmentDistance(h, h, -h, h, a, b, c, d),
    segmentDistance(-h, h, -h, -h, a, b, c, d),
  )
}

/**
 * The bearing (one of BEARINGS) whose plates (`probes`: the marks' plates north-up at a few view distances) keep
 * farthest from every track segment (`segments`, trackSegments' layout) and from every other station point less
 * STATION_PAD_M, within NEAR_M; of those within TIE_M (or half the best) of it, the first in preference order. With
 * nothing near, north. Plates, not a line, so a bearing running between a line's two direction tracks (4.7 m off each)
 * counts as blocked, while one crossing them just past the marker counts as clear.
 */
export function clearBearing(origin: Ground, segments: Float32Array, others: readonly Ground[], probes: readonly PlateProbe[]): Ground {
  const near: number[] = []
  for (let o = 0; o < segments.length; o += 4) {
    const x0 = segments[o]! - origin.x
    const z0 = segments[o + 1]! - origin.z
    const x1 = segments[o + 2]! - origin.x
    const z1 = segments[o + 3]! - origin.z
    if (Math.min(x0, x1) > NEAR_M || Math.max(x0, x1) < -NEAR_M || Math.min(z0, z1) > NEAR_M || Math.max(z0, z1) < -NEAR_M) continue
    near.push(x0, z0, x1, z1)
  }
  const points = others.flatMap((p) => (Math.abs(p.x - origin.x) <= NEAR_M && Math.abs(p.z - origin.z) <= NEAR_M ? [p.x - origin.x, p.z - origin.z] : []))
  const scores = BEARINGS.map((dir) => {
    let best = NEAR_M
    for (const { along, half } of probes) {
      const cx = dir.x * along
      const cz = dir.z * along
      for (let o = 0; o < near.length; o += 4) best = Math.min(best, squareDistance(near[o]!, near[o + 1]!, near[o + 2]!, near[o + 3]!, cx, cz, half))
      for (let o = 0; o < points.length; o += 2) {
        const x = points[o]!
        const z = points[o + 1]!
        best = Math.min(best, squareDistance(x, z, x, z, cx, cz, half) - STATION_PAD_M)
      }
    }
    return best
  })
  const top = Math.max(...scores)
  // Near-ties only while the best is roomy: a bearing that touches a track never ties one 2 m clear.
  const slack = Math.min(TIE_M, top / 2)
  return BEARINGS[scores.findIndex((s) => s >= top - slack)]!
}

/**
 * The marks of every station group listed in the amenities file, in group order then AMENITY_ORDER, each group's row
 * along its clear bearing (scored by `probes` of its mark count, against every station but the group's own members).
 */
export function amenityMarks(
  groups: readonly StationLike[],
  amenities: AmenitiesFile,
  segments: Float32Array,
  stations: readonly { id: string; pos: Ground }[],
  probes: (count: number) => readonly PlateProbe[],
): AmenityMark[] {
  const out: AmenityMark[] = []
  for (const g of groups) {
    const { kinds } = groupAmenities(amenities.stations, g.memberIds)
    if (kinds.length === 0) continue
    const own = new Set(g.memberIds)
    const others = stations.flatMap((s) => (own.has(s.id) ? [] : [s.pos]))
    const dir = clearBearing(g.pos, segments, others, probes(kinds.length))
    kinds.forEach((kind, k) => out.push({ stationId: g.id, memberIds: g.memberIds, kind, k, pos: g.pos, dir }))
  }
  return out
}

/** How far a footprint's hull reaches from `origin` along unit `dir`, meters: past it a mark is outside the hull. */
export function hullReach(footprint: Footprint, origin: Ground, dir: Ground): number {
  let reach = -Infinity
  for (const [hx, hz] of footprint.hull) {
    reach = Math.max(reach, (footprint.originX + hx - origin.x) * dir.x + (footprint.originZ + hz - origin.z) * dir.z)
  }
  return reach
}

/** The k-th mark's centre along its bearing, meters from the station point: past `clearM`, a gap, then plates of half
 *  size `halfM` one gap apart. */
export function markCentre(k: number, clearM: number, halfM: number, gapM: number): number {
  return clearM + gapM + halfM + k * (2 * halfM + gapM)
}
