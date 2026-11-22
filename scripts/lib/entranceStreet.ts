/** Joins one station entrance to the street it opens onto: the nearest named street, the side of it, the cross
 *  street at a corner, and the plaza it is inside. Pure geometry on local meters (x east, z south); the street-file
 *  build runs it on the same decimeter coordinates it stores. Which ways count is `isStreet` in src/lib/streetClass.ts. */
import type { StreetJoin, StreetSide } from '../../src/data/streetSchema.ts'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { searchTokens } from '../../src/lib/searchText.ts'
import { isArea, isStreet } from '../../src/lib/streetClass.ts'
import { insidePolygon, nearestOnPolyline, SIDE_MIN_M, type Nearest } from './streetGeometry.ts'

/** An OSM way as the join sees it: meters. `closed` is `isClosedRing(way.nodes)` on the street file's way; a closed
 *  `highway=pedestrian` way is a plaza (its `points` are the ring, first point repeated last). */
export interface JoinWay {
  id: number
  highway: string
  name: string | null
  closed: boolean
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

const COS_CORNER = Math.cos((CORNER_MIN_ANGLE_DEG * Math.PI) / 180)
const EPS = 1e-9

/** The name reduced to what makes streets the same street: "N 7th St" and "North 7th Street" share a key.
 *  It reuses the station-search synonym table (src/lib/searchText.ts), so a change to search spellings changes join
 *  keys too: rerun the street build and read its diff after touching that table. */
export function streetKey(name: string): string {
  return searchTokens(name)
    .map((t) => t.canon)
    .join(' ')
}

interface Hit extends Nearest {
  way: JoinWay
  key: string
}

function plazaAt(p: LocalPoint, ways: readonly JoinWay[]): string | null {
  let plaza: JoinWay | null = null
  for (const way of ways) {
    if (way.name === null || !isArea(way, way.closed) || !insidePolygon(p, way.points)) continue
    if (plaza === null || way.id < plaza.id) plaza = way
  }
  return plaza?.name ?? null
}

/** |cos| of the angle between two directions' lines: 1 parallel, 0 perpendicular. */
function parallelism(a: Nearest, b: Nearest): number {
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
function betweenCarriageways(primary: Hit, side: readonly [number, number], same: readonly Hit[]): boolean {
  return same.some(
    (other) =>
      other !== primary &&
      other.dist <= MEDIAN_MAX_M &&
      other.side !== null &&
      parallelism(primary, other) >= COS_CORNER &&
      side[0] * other.side[0] + side[1] * other.side[1] < 0,
  )
}

const NONE: StreetJoin = { street: null, wayId: null, cross: null, crossWayId: null, side: null, plaza: null }

/** The street an entrance at p opens onto. Entrances inside a named pedestrian area also get its name as `plaza`.
 *  Ties in distance go to the lower way id, so the result never depends on the order of `ways`.
 *  A median entrance keeps its cross street ("Broadway median at W 72 St"). */
export function joinEntrance(p: LocalPoint, ways: readonly JoinWay[]): StreetJoin {
  const plaza = plazaAt(p, ways)
  const hits: Hit[] = []
  for (const way of ways) {
    if (!isStreet(way, way.closed)) continue
    const near = nearestOnPolyline(p, way.points)
    if (near !== null && near.dist <= JOIN_RADIUS_M) hits.push({ ...near, way, key: streetKey(way.name!) })
  }
  hits.sort((a, b) => a.dist - b.dist || a.way.id - b.way.id)
  const primary = hits[0]
  if (primary === undefined) return { ...NONE, plaza }

  // A cross street must reach the entrance: a T-junction's stem or a dead end short of the primary is not a corner.
  const cross = hits.find(
    (h) =>
      h.key !== primary.key &&
      h.dist <= primary.dist + CORNER_SLACK_M &&
      h.pastEnd <= SIDE_MIN_M &&
      parallelism(primary, h) <= COS_CORNER,
  )

  const primarySide = primary.side
  let side: StreetSide | null = null
  if (primarySide !== null) {
    if (betweenCarriageways(primary, primarySide, hits.filter((h) => h.key === primary.key))) side = 'median'
    else if (cross?.side) side = quadrantSide(primarySide[0] + cross.side[0], primarySide[1] + cross.side[1])
    // Mid-block, or on the cross street's centerline where only the primary's side is known.
    else side = axisSide(primarySide)
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
