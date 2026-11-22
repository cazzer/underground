/** An authored connector or machine can cite the pinned OSM element it follows ("way/N" or "node/N"). The merge
 *  resolves the citation against the pinned ways, lines and nodes and requires an authored point of the connector
 *  within OSM_REF_TOLERANCE_M of it (an open way: of one of its vertices), so a typo or a wrong id fails the build. No IO. */
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { finite, text } from './check.ts'
import type { Ctx } from './stationCtx.ts'
import { distanceToRing } from './stationGeometry.ts'
import type { StationSources } from './stationInputs.ts'

export const OSM_REF_TOLERANCE_M = 1

const REF = /^(way|node)\/([0-9]+)$/

function localPoints(ctx: Ctx, ll: readonly (readonly [number, number])[], what: string): LocalPoint[] {
  return ll.map(([lat, lon], i) => ctx.frame.fromLatLon(finite(lat, `${what}[${i}].lat`), finite(lon, `${what}[${i}].lon`)))
}

/** Distance from `p` to a pinned way. A closed one (at least 4 points, first equal to last) counts as its area: 0
 *  inside, else the distance to the ring. An open one (a stair, whose vertices are its landings) is measured to its
 *  nearest vertex, not along its segments. */
function distanceToLine(p: LocalPoint, pts: LocalPoint[]): number {
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (pts.length >= 4 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]) return distanceToRing(p, pts)
  return Math.min(...pts.map((v) => Math.hypot(p[0] - v[0], p[1] - v[1])))
}

/**
 * Validates a connector's `osmRef`, returns it, and throws unless one of `ends` (its authored points, entrance ends
 * left out) lies within OSM_REF_TOLERANCE_M of the element. A way is looked up among the pinned platform ways, then
 * the pinned lines.
 */
export function checkOsmRef(ctx: Ctx, sources: StationSources, raw: unknown, ends: readonly LocalPoint[], path: string): string {
  const ref = text(raw, path)
  const m = REF.exec(ref)
  if (!m) throw new Error(`${path}: expected "way/<id>" or "node/<id>", got ${JSON.stringify(ref)}`)
  const id = Number(m[2])
  let distance: (p: LocalPoint) => number
  if (m[1] === 'node') {
    const node = sources.osm.nodes?.find((n) => n.id === id)
    if (!node) throw new Error(`${path}: OSM node ${id} is not in the pinned sources (add it to fetch.osmNodes, then run npm run data:stations:fetch)`)
    const [pt] = localPoints(ctx, [[node.lat, node.lon]], `osm node ${id}`)
    distance = (p) => Math.hypot(p[0] - pt![0], p[1] - pt![1])
  } else {
    const way = sources.osm.ways.find((w) => w.id === id)
    const line = way ? undefined : sources.osm.lines?.find((l) => l.id === id)
    const shape = way?.ring ?? line?.points
    if (!shape) throw new Error(`${path}: OSM way ${id} is not in the pinned sources (add it to fetch.osmLines, then run npm run data:stations:fetch)`)
    const pts = localPoints(ctx, shape, `osm way ${id}`)
    distance = (p) => distanceToLine(p, pts)
  }
  if (ends.length === 0) throw new Error(`${path}: ${ref} needs an authored "at" end (not an entrance end) to check against`)
  const nearest = Math.min(...ends.map(distance))
  if (!(nearest <= OSM_REF_TOLERANCE_M)) {
    throw new Error(`${path}: no end is within ${OSM_REF_TOLERANCE_M} m of ${ref} (nearest ${nearest.toFixed(2)} m)`)
  }
  return ref
}
