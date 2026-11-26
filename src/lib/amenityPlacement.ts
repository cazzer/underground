/**
 * Where a station's amenity marks (StationAmenities.tsx, enp.5) lie on the ground: in a row across the screen anchored
 * on one "clear bearing" per station, the compass direction (north preferred) whose row keeps farthest from the drawn
 * tracks and the other station markers, just past the station's marker (or past a shown interior's footprint,
 * amenityCovered.ts). Pure; the layout runs once per load, and `rowCentreInto` and `plateReach`, which run per frame,
 * allocate nothing.
 */
import type { AmenitiesFile } from '../data/amenitiesSchema'
import { groupAmenities, type AmenityKind } from './amenityGlyphs'
import type { Footprint } from './interiorFootprint'
import type { Ground } from './projection'
import { segmentsNear, type TrackGrid } from './trackGrid'

/** Only tracks and stations this close to the station are scored (no plate reaches past it). */
export const NEAR_M = 80
/** A bearing within this of the best score (at most half the best) counts as clear, so the preferred one wins near-ties. */
export const TIE_M = 3
/** Another station's marker counts as a track this much nearer (its radius at street zoom, MARKER_MIN_METERS). */
export const STATION_PAD_M = 6

/** A plate a bearing is scored by: a north-up square of half size `half` centred (x, z) meters from the station point. */
export interface PlateProbe {
  x: number
  z: number
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

/** One mark: a kind at a station lead, the k-th of `n` in its station's row, anchored along `dir`. */
export interface AmenityMark {
  /** The station group's lead id. */
  stationId: string
  /** Every member of the group (a shown interior covering any of them moves the mark). */
  memberIds: readonly string[]
  kind: AmenityKind
  /** Its place in the row, left to right on screen (AMENITY_ORDER, as the panel shows them), and the row's length. */
  k: number
  n: number
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
 * The bearing (one of BEARINGS) whose plates (`probes` of it: the row's plates north-up at a few view distances) keep
 * farthest from every track segment near (`grid`) and from every other station point (`others`) less STATION_PAD_M,
 * within NEAR_M; of those within TIE_M (or half the best) of it, the first in preference order. With nothing near,
 * north. Plates, not a line, so a bearing running between a line's two direction tracks (4.7 m off each) counts as
 * blocked, while one crossing them just past the marker counts as clear.
 */
export function clearBearing(origin: Ground, grid: TrackGrid, others: readonly Ground[], probes: (dir: Ground) => readonly PlateProbe[]): Ground {
  const near = segmentsNear(grid, origin, NEAR_M)
  const points = others.flatMap((p) => (Math.abs(p.x - origin.x) <= NEAR_M && Math.abs(p.z - origin.z) <= NEAR_M ? [p.x - origin.x, p.z - origin.z] : []))
  const scores = BEARINGS.map((dir) => {
    let best = NEAR_M
    for (const { x: cx, z: cz, half } of probes(dir)) {
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
 * One station group's marks, in AMENITY_ORDER (none when the amenities file lists none of its members), its row
 * anchored along its clear bearing (scored by `probes` of its mark count, against `stations` but the group's members).
 */
export function groupMarks(
  g: StationLike,
  amenities: AmenitiesFile,
  grid: TrackGrid,
  stations: readonly { id: string; pos: Ground }[],
  probes: (count: number, dir: Ground) => readonly PlateProbe[],
): AmenityMark[] {
  const { kinds } = groupAmenities(amenities.stations, g.memberIds)
  if (kinds.length === 0) return []
  const own = new Set(g.memberIds)
  const others = stations.flatMap((s) => (own.has(s.id) ? [] : [s.pos]))
  const dir = clearBearing(g.pos, grid, others, (d) => probes(kinds.length, d))
  return kinds.map((kind, k) => ({ stationId: g.id, memberIds: g.memberIds, kind, k, n: kinds.length, pos: g.pos, dir }))
}

/** Every listed group's marks, in group order (groupMarks; the scene runs it a few groups at a time). */
export function amenityMarks(
  groups: readonly StationLike[],
  amenities: AmenitiesFile,
  grid: TrackGrid,
  stations: readonly { id: string; pos: Ground }[],
  probes: (count: number, dir: Ground) => readonly PlateProbe[],
): AmenityMark[] {
  return groups.flatMap((g) => groupMarks(g, amenities, grid, stations, probes))
}

/** How far a footprint's hull reaches from `origin` along unit `dir`, meters: past it a mark is outside the hull. */
export function hullReach(footprint: Footprint, origin: Ground, dir: Ground): number {
  let reach = -Infinity
  for (const [hx, hz] of footprint.hull) {
    reach = Math.max(reach, (footprint.originX + hx - origin.x) * dir.x + (footprint.originZ + hz - origin.z) * dir.z)
  }
  return reach
}

/**
 * How far the footprint's hull reaches from `origin` along unit `dir` within the band of lateral offsets [lo, hi]
 * (measured along dir's left normal, (-dir.z, dir.x)), meters; -Infinity when the band misses the hull. A row inside
 * the band clears the hull once it is past this, so it can sit in a hull's corner instead of out at its farthest vertex.
 */
export function bandReach(footprint: Footprint, origin: Ground, dir: Ground, lo: number, hi: number): number {
  const hull = footprint.hull
  let reach = -Infinity
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i]!
    const [bx, bz] = hull[(i + 1) % hull.length]!
    const pax = footprint.originX + ax - origin.x
    const paz = footprint.originZ + az - origin.z
    const pbx = footprint.originX + bx - origin.x
    const pbz = footprint.originZ + bz - origin.z
    const ua = pax * dir.x + paz * dir.z
    const va = -pax * dir.z + paz * dir.x
    const ub = pbx * dir.x + pbz * dir.z
    const vb = -pbx * dir.z + pbz * dir.x
    // The edge clipped to the band, in (u, v): its along value at the clipped ends.
    let t0 = 0
    let t1 = 1
    const dv = vb - va
    if (dv === 0) {
      if (va < lo || va > hi) continue
    } else {
      const ta = (lo - va) / dv
      const tb = (hi - va) / dv
      t0 = Math.max(t0, Math.min(ta, tb))
      t1 = Math.min(t1, Math.max(ta, tb))
      if (t0 > t1) continue
    }
    reach = Math.max(reach, ua + (ub - ua) * t0, ua + (ub - ua) * t1)
  }
  return reach
}

/** How far a square plate of half size `half`, yawed by azimuth `az` (its local x east-ish at 0), reaches from its
 *  centre along unit `dir`: `half` along an axis, up to √2 × `half` on a diagonal. */
export function plateReach(half: number, dir: Ground, az: number): number {
  const c = Math.cos(az)
  const s = Math.sin(az)
  return half * (Math.abs(dir.x * c - dir.z * s) + Math.abs(dir.x * s + dir.z * c))
}

/** The screen's right on the ground at camera azimuth `az` (x, z): east at north-up. */
export const rightX = (az: number): number => Math.cos(az)
export const rightZ = (az: number): number => -Math.sin(az)

/**
 * The centre of mark `k` of a row of `n` (meters, scene x/z, written into `out`; allocation-free): the row runs across
 * the screen (along its right at azimuth `az`), plates `plateM` half size one `gapM` apart, anchored on the bearing
 * `dir` from `origin` past `clearM`. Its first plate sits on the anchor when the bearing points right on screen, its
 * last when it points left, its middle when straight up or down (blended between), and the row moves out along the
 * bearing just enough that no plate comes nearer than the anchor's: so no plate crosses the marker whichever way the
 * view turns, and the marks keep the panel's order, left to right.
 */
export function rowCentreInto(out: Ground, k: number, n: number, origin: Ground, dir: Ground, clearM: number, plateM: number, gapM: number, az: number): Ground {
  const rx = rightX(az)
  const rz = rightZ(az)
  const rd = dir.x * rx + dir.z * rz
  const step = 2 * plateM + gapM
  const w = ((1 - rd) / 2) * (n - 1)
  // The plate nearest the marker along the bearing: offsets (j - w) × step × rd, least at j = 0 or n - 1.
  const nearest = Math.min(-w * step * rd, (n - 1 - w) * step * rd)
  const along = clearM + gapM + plateReach(plateM, dir, az) + Math.max(0, -nearest)
  const across = (k - w) * step
  out.x = origin.x + dir.x * along + rx * across
  out.z = origin.z + dir.z * along + rz * across
  return out
}
