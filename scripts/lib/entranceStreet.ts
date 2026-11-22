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

/** The street whose carriageways the entrance sits between, if any: some key with two roughly parallel ways on
 *  opposite sides, each within MEDIAN_MAX_M and each running alongside the entrance (not ending short of it, which
 *  would be a jog). Only keys with a hit within `maxDist` are considered, nearest key first; returns that key's
 *  nearest way. `hits` is sorted by distance. */
function medianStreet(hits: readonly Hit[], maxDist: number): Hit | undefined {
  const keys = new Set<string>()
  for (const h of hits) {
    if (h.dist > maxDist) break
    keys.add(h.key)
  }
  for (const key of keys) {
    const alongside = hits.flatMap((h) =>
      h.key === key && h.dist <= MEDIAN_MAX_M && h.side !== null && h.pastEnd <= SIDE_MIN_M
        ? [{ hit: h, side: h.side }]
        : [],
    )
    const opposed = alongside.some((a, i) =>
      alongside
        .slice(i + 1)
        .some(
          (b) => parallelism(a.hit, b.hit) >= COS_CORNER && a.side[0] * b.side[0] + a.side[1] * b.side[1] < 0,
        ),
    )
    if (opposed) return hits.find((h) => h.key === key)
  }
  return undefined
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

  // At an intersection of a dual carriageway the nearest street can be the cross street, so the median is found on
  // any near key, and that street is then the one the entrance is named on.
  const median = medianStreet(hits, primary.dist + CORNER_SLACK_M)
  const street = median ?? primary

  // A cross street must reach the entrance: a T-junction's stem or a dead end short of the street is not a corner.
  const cross = hits.find(
    (h) =>
      h.key !== street.key &&
      h.dist <= primary.dist + CORNER_SLACK_M &&
      h.pastEnd <= SIDE_MIN_M &&
      parallelism(street, h) <= COS_CORNER,
  )

  const streetSide = street.side
  let side: StreetSide | null = null
  if (median !== undefined) side = 'median'
  else if (streetSide !== null) {
    if (cross?.side) side = quadrantSide(streetSide[0] + cross.side[0], streetSide[1] + cross.side[1])
    // Mid-block, or on the cross street's centerline where only the street's side is known.
    else side = axisSide(streetSide)
  }
  return {
    street: street.way.name,
    wayId: street.way.id,
    cross: cross?.way.name ?? null,
    crossWayId: cross?.way.id ?? null,
    side,
    plaza,
  }
}
