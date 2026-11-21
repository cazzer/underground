/** Geometry sanity for StationFacts. Bad OSM input must not turn into a confident-looking result.
 *  A bad platform ring fails the station (the classifier cannot say what it is); a bad track or entrance
 *  is dropped and named, so one broken way does not sink the rest. */
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import type { StationFacts } from './stationFacts.ts'

const finite = (p: LocalPoint): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1])

export interface CleanedFacts {
  facts: StationFacts
  /** Problems that make the station unclassifiable; one line each, naming the way. */
  fatal: string[]
  /** Tracks and entrances removed from `facts`, one line each. */
  dropped: string[]
}

export function cleanGeometry(f: StationFacts): CleanedFacts {
  const fatal: string[] = []
  const dropped: string[] = []
  for (const p of f.platforms) {
    if (!p.outline.every(finite)) fatal.push(`platform way ${p.osmWay}: outline has a non-finite point`)
    else if (new Set(p.outline.map((pt) => `${pt[0]},${pt[1]}`)).size < 3) fatal.push(`platform way ${p.osmWay}: outline has fewer than 3 distinct points`)
  }
  const tracks = f.tracks.filter((t) => {
    const why = !t.path.every(finite) ? 'path has a non-finite point' : t.path.length < 2 ? 'path has fewer than 2 points' : null
    if (why) dropped.push(`dropped track ${t.ref}: ${why}`)
    return why === null
  })
  const entrances = f.entrances.filter((e, i) => {
    if (finite(e.at)) return true
    dropped.push(`dropped entrance ${i}: non-finite position`)
    return false
  })
  return { facts: { ...f, tracks, entrances }, fatal, dropped }
}
