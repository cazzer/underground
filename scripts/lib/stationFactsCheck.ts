/** Geometry sanity for StationFacts. Bad OSM input must not turn into a confident-looking result:
 *  the classifier reports these problems as its reasons instead of computing on NaN. */
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import type { StationFacts } from './stationFacts.ts'

const finite = (p: LocalPoint): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1])

/** One line per problem, each naming the way or track; empty when the geometry is usable. */
export function geometryProblems(f: StationFacts): string[] {
  const out: string[] = []
  for (const p of f.platforms) {
    if (!p.outline.every(finite)) out.push(`platform way ${p.osmWay}: outline has a non-finite point`)
    else if (new Set(p.outline.map((pt) => `${pt[0]},${pt[1]}`)).size < 3) out.push(`platform way ${p.osmWay}: outline has fewer than 3 distinct points`)
  }
  for (const t of f.tracks) {
    if (!t.path.every(finite)) out.push(`track ${t.ref}: path has a non-finite point`)
    else if (t.path.length < 2) out.push(`track ${t.ref}: path has fewer than 2 points`)
  }
  f.entrances.forEach((e, i) => {
    if (!finite(e.at)) out.push(`entrance ${i}: non-finite position`)
  })
  return out
}
