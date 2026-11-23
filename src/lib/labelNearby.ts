/** The station markers the street labels keep clear of (o3r.6). Pure. */
import type { Ground } from './projection'

export interface NearbyMarkers {
  ids: string[]
  points: Ground[]
}

/**
 * The stations within `reachM` of any of `anchors` (the drawn street layers' anchors), each once, in `stations`' order,
 * leaving out `excluded` (the focused station, which draws no marker or a focus ring, and the members its interior
 * covers).
 */
export function nearbyMarkers(
  stations: readonly { id: string; pos: Ground }[],
  anchors: readonly Ground[],
  excluded: ReadonlySet<string>,
  reachM: number,
): NearbyMarkers {
  const ids: string[] = []
  const points: Ground[] = []
  for (const s of stations) {
    if (excluded.has(s.id)) continue
    if (!anchors.some((a) => Math.hypot(s.pos.x - a.x, s.pos.z - a.z) <= reachM)) continue
    ids.push(s.id)
    points.push(s.pos)
  }
  return { ids, points }
}
