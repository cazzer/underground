/** Joins one station entrance to the street it opens onto: the nearest named street, the side of it, the cross
 *  street at a corner, and the plaza it is inside. Pure geometry on local meters (x east, z south); the street-file
 *  build runs it on the same decimeter coordinates it stores. Which ways count is `isStreet` in src/lib/streetClass.ts. */
import type { StreetJoin, StreetSide } from '../../src/data/streetSchema.ts'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { searchTokens } from '../../src/lib/searchText.ts'
import { isArea, isStreet } from '../../src/lib/streetClass.ts'

/** An OSM way as the join sees it: meters, closed when the first point equals the last. */
export interface JoinWay {
  id: number
  highway: string
  name: string | null
  points: readonly LocalPoint[]
}

/** Streets farther than this from the entrance are not candidates. */
export const JOIN_RADIUS_M = 40
/** A cross street counts as a corner if it is within this much of the nearest street's distance. */
export const CORNER_SLACK_M = 10
/** A cross street must run at least this far off the primary's direction (parallel streets are not corners). */
export const CORNER_MIN_ANGLE_DEG = 30
/** Another carriageway of the same street within this far on the other side makes the entrance a median one. */
export const MEDIAN_MAX_M = 25
/** Closer than this to the centerline there is no side. */
export const SIDE_MIN_M = 1

const COS_CORNER = Math.cos((CORNER_MIN_ANGLE_DEG * Math.PI) / 180)
const EPS = 1e-9

/** The name reduced to what makes streets the same street: "N 7th St" and "North 7th Street" share a key. */
export function streetKey(name: string): string {
  return searchTokens(name)
    .map((t) => t.canon)
    .join(' ')
}

interface Hit {
  way: JoinWay
  key: string
  dist: number
  /** Unit direction of the segment the nearest point is on. */
  tx: number
  tz: number
  /** Unit vector from the way toward the entrance, perpendicular to the way; null within SIDE_MIN_M of its line. */
  side: readonly [number, number] | null
}

function isClosedPoints(points: readonly LocalPoint[]): boolean {
  const first = points[0]
  const last = points[points.length - 1]
  return points.length >= 4 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
}

/** Nearest point of the polyline to p, with its segment's direction and the side p lies on. Null for a way with no length. */
function nearestHit(p: LocalPoint, way: JoinWay, key: string): Hit | null {
  let best: Hit | null = null
  for (let i = 0; i + 1 < way.points.length; i++) {
    const a = way.points[i]!
    const b = way.points[i + 1]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len === 0) continue
    const tx = dx / len
    const tz = dz / len
    const along = Math.min(len, Math.max(0, (p[0] - a[0]) * tx + (p[1] - a[1]) * tz))
    const rx = p[0] - (a[0] + tx * along)
    const rz = p[1] - (a[1] + tz * along)
    const dist = Math.hypot(rx, rz)
    if (best !== null && dist >= best.dist) continue
    // The perpendicular offset from the segment's infinite line stays meaningful past the way's end.
    const offset = tx * (p[1] - a[1]) - tz * (p[0] - a[0])
    const sign = Math.sign(offset)
    const side = Math.abs(offset) < SIDE_MIN_M ? null : ([-tz * sign, tx * sign] as const)
    best = { way, key, dist, tx, tz, side }
  }
  return best
}

function insidePolygon(p: LocalPoint, ring: readonly LocalPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function plazaAt(p: LocalPoint, ways: readonly JoinWay[]): string | null {
  let plaza: JoinWay | null = null
  for (const way of ways) {
    if (way.name === null || !isClosedPoints(way.points) || !isArea(way, true)) continue
    if (!insidePolygon(p, way.points)) continue
    if (plaza === null || way.id < plaza.id) plaza = way
  }
  return plaza?.name ?? null
}

/** |cos| of the angle between two directions' lines: 1 parallel, 0 perpendicular. */
function parallelism(a: Hit, b: Hit): number {
  return Math.abs(a.tx * b.tx + a.tz * b.tz)
}

function axisSide(s: readonly [number, number]): StreetSide {
  if (Math.abs(s[0]) >= Math.abs(s[1])) return s[0] > 0 ? 'east' : 'west'
  return s[1] > 0 ? 'south' : 'north'
}

/** The corner of two streets by the sign quadrant of their summed side vectors; exact zero goes to +x and -z. */
function quadrantSide(sx: number, sz: number): StreetSide {
  const east = sx >= -EPS
  const north = sz <= EPS
  if (north) return east ? 'NE' : 'NW'
  return east ? 'SE' : 'SW'
}

/** True when another carriageway of the same street, near and roughly parallel, lies on the opposite side. */
function betweenCarriageways(primary: Hit, same: readonly Hit[]): boolean {
  if (primary.side === null) return false
  return same.some(
    (other) =>
      other !== primary &&
      other.dist <= MEDIAN_MAX_M &&
      other.side !== null &&
      parallelism(primary, other) >= COS_CORNER &&
      primary.side![0] * other.side[0] + primary.side![1] * other.side[1] < 0,
  )
}

const NONE: StreetJoin = { street: null, wayId: null, cross: null, crossWayId: null, side: null, plaza: null }

/** The street an entrance at p opens onto. Entrances inside a named pedestrian area also get its name as `plaza`.
 *  Ties in distance go to the lower way id, so the result never depends on the order of `ways`. */
export function joinEntrance(p: LocalPoint, ways: readonly JoinWay[]): StreetJoin {
  const plaza = plazaAt(p, ways)
  const hits: Hit[] = []
  for (const way of ways) {
    if (!isStreet(way, isClosedPoints(way.points))) continue
    const key = streetKey(way.name!)
    if (key === '') continue
    const hit = nearestHit(p, way, key)
    if (hit !== null && hit.dist <= JOIN_RADIUS_M) hits.push(hit)
  }
  hits.sort((a, b) => a.dist - b.dist || a.way.id - b.way.id)
  const primary = hits[0]
  if (primary === undefined) return { ...NONE, plaza }

  const cross = hits.find(
    (h) =>
      h.key !== primary.key &&
      h.dist <= primary.dist + CORNER_SLACK_M &&
      parallelism(primary, h) <= COS_CORNER,
  )

  let side: StreetSide | null = null
  if (primary.side !== null) {
    if (cross?.side) {
      side = quadrantSide(primary.side[0] + cross.side[0], primary.side[1] + cross.side[1])
    } else if (cross === undefined && betweenCarriageways(primary, hits.filter((h) => h.key === primary.key))) {
      side = 'median'
    } else {
      // Mid-block, or on the cross street's centerline where only the primary's side is known.
      side = axisSide(primary.side)
    }
  }
  return {
    street: primary.way.name,
    wayId: primary.way.id,
    cross: cross?.way.name ?? null,
    crossWayId: cross?.way.id ?? null,
    side,
    plaza,
  }
}
