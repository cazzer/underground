/**
 * What the prefetch (o3r.8) warms: from the prefetch set (`prefetchStations`, the camera-driven wider choice of
 * useViewStations) the interior files and street layers a quick zoom would want, before the reveal begins. Pure.
 * Only ids in the set ever appear, so a prefetch follows the camera and never the location fix or its nearest station.
 */
import { MAX_PREFETCH_STATIONS, PREFETCH_EXTRA_INTERIORS, viewStreetIds } from '../lib/viewStations'
import { viewInteriorIds, type IndexLoad } from './interiorLoad'

export interface PrefetchTargets {
  /** Interior file ids to warm: at most `interiorCap` + PREFETCH_EXTRA_INTERIORS with the focused file counted (it loads on its own). */
  interiors: readonly string[]
  /** Station leads whose street layers (a complex's member files too) to warm: at most MAX_PREFETCH_STATIONS, the focused one counted. */
  streets: readonly string[]
}

/**
 * The files to warm for `prefetch` (leads, nearest first), the focused station's own left out (its focus path loads it)
 * but counted. Interiors: stations the index doesn't list skipped, a complex's one file once, none until the index is
 * ready; a file `skip` names (one that failed lately) is passed over without taking a slot. `interiorCap` is
 * viewInteriorCap of the window.
 */
export function prefetchTargets(
  prefetch: readonly string[],
  focusedId: string | null,
  index: IndexLoad,
  interiorCap: number,
  skip: (file: string) => boolean = () => false,
): PrefetchTargets {
  return {
    interiors: viewInteriorIds(prefetch, focusedId, index, interiorCap + PREFETCH_EXTRA_INTERIORS, skip),
    streets: viewStreetIds(prefetch, focusedId, MAX_PREFETCH_STATIONS),
  }
}
