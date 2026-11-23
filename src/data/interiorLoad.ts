import type { InteriorModel } from '../scene/interiorModel'
import type { StationLayout } from '../lib/tripSteps'
import type { StationIndex } from './stationSchema'

export type InteriorLoad =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: InteriorModel }

/** The last settled load attempt, tagged with the station it was for. */
export interface SettledLoad {
  id: string
  load: InteriorLoad
}

const reportedUncovered = new Set<string>()
const NONE: InteriorLoad = { status: 'none' }
const LOADING: InteriorLoad = { status: 'loading' }

/** The station index (public/data/stations/index.json): which stations have an interior file. */
export type IndexLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; index: StationIndex }

/**
 * Whether the focused station keeps its street-level marker and tie. A station with an interior (ready, or still
 * loading, so a good load doesn't pop) is marked by that interior and draws neither; one with no interior (not in
 * the index, or the index failed) or a failed load keeps them as the fallback. While the index is still loading
 * nothing is known, so the marker stays hidden rather than flashing for a station that turns out to have one.
 * Retry on a failed load goes back to loading, so the marker blinks off until the retry settles (and on again if it
 * fails again); that is fine.
 */
export function focusedMarkerShown(stationId: string | null, index: IndexLoad, load: InteriorLoad): boolean {
  if (!stationId || index.status === 'loading') return false
  return load.status === 'none' || load.status === 'error'
}

/** Every station an interior covers: its complex's members, else its own station alone. */
export function interiorStationIds(interior: { stationId: string; memberStationIds?: readonly string[] }): readonly string[] {
  return interior.memberStationIds ?? [interior.stationId]
}

/** Whether the interior covers the station (any member of a complex). False for no interior or no station. */
export function interiorCovers(interior: { stationId: string; memberStationIds?: readonly string[] } | null, id: string | null): boolean {
  if (!interior || id === null) return false
  return interior.memberStationIds ? interior.memberStationIds.includes(id) : interior.stationId === id
}

/** The file id of the station's interior (a complex member maps to its complex's file) when the index is ready and lists it; otherwise null. */
export function interiorIdOf(stationId: string | null, index: IndexLoad): string | null {
  if (!stationId || index.status !== 'ready') return null
  if (!Object.hasOwn(index.index.stations, stationId)) return null
  return index.index.stations[stationId]!.file ?? stationId
}

/**
 * What the station's interior is, for the trip steps: its file's provenance, `'none'` when the ready index doesn't list
 * it, null while the index is loading or failed (nothing is known, so nothing is said).
 */
export function layoutOf(stationId: string, index: IndexLoad): StationLayout {
  if (index.status !== 'ready') return null
  const file = interiorIdOf(stationId, index)
  if (file === null) return 'none'
  const entry = Object.hasOwn(index.index.stations, file) ? index.index.stations[file]! : index.index.stations[stationId]!
  return entry.provenance
}

/** The distinct interior file ids of the hand-authored stations in the index, sorted; none until it is ready. */
export function authoredInteriorIds(index: IndexLoad): string[] {
  if (index.status !== 'ready') return []
  const ids = new Set<string>()
  for (const [id, entry] of Object.entries(index.index.stations)) if (entry.provenance === 'authored') ids.add(entry.file ?? id)
  return [...ids].sort()
}

/**
 * For a set of interiors loading at once: the ids not loaded yet (to fetch), and whether one loaded after `shownKey`
 * (the comma-joined ids loaded at the last render) was taken, so the render that showed them is stale.
 */
export function modelsToLoad(ids: readonly string[], isLoaded: (id: string) => boolean, shownKey: string): { fetch: string[]; stale: boolean } {
  const shown = new Set(shownKey === '' ? [] : shownKey.split(','))
  return { fetch: ids.filter((id) => !isLoaded(id)), stale: ids.some((id) => isLoaded(id) && !shown.has(id)) }
}

/** Shared, so an unchanged "no siblings" keeps its identity. */
export const NO_SIBLINGS: readonly string[] = Object.freeze([])

/** The other stations that share the focused station's interior file (its complex siblings); empty when none or the index isn't ready. */
export function siblingIdsOf(stationId: string | null, index: IndexLoad): readonly string[] {
  const file = interiorIdOf(stationId, index)
  if (file === null || index.status !== 'ready') return NO_SIBLINGS
  const siblings = Object.entries(index.index.stations)
    .filter(([id, entry]) => id !== stationId && (entry.file ?? id) === file)
    .map(([id]) => id)
  return siblings.length > 0 ? siblings : NO_SIBLINGS
}

/**
 * The siblings whose markers and ties the scene hides: those the loaded interior really covers. The index says which
 * stations share a file, the model says which it draws; a stale or mixed deploy where they disagree hides nothing it
 * doesn't draw. Nothing is hidden before the model loads.
 */
export function hiddenSiblingIds(siblings: readonly string[], model: { stationId: string; memberStationIds?: readonly string[] } | null): readonly string[] {
  if (!model || siblings.length === 0) return NO_SIBLINGS
  const covered = siblings.filter((id) => interiorCovers(model, id))
  return covered.length > 0 ? covered : NO_SIBLINGS
}

/**
 * What to show for station `stationId` (null: no station focused). Until the index is ready, or if it
 * failed, there is nothing to say about the station (almost no station has an interior, so a panel
 * would be wrong for nearly all of them); a station the index doesn't list has none either. Then a
 * cached model wins, so a revisit is ready on its first render, and a settled attempt for another
 * station means this one is loading. A model that doesn't cover the station (the index and the file
 * disagree) is an error, not a panel for the wrong station.
 */
export function deriveInteriorLoad(
  stationId: string | null,
  index: IndexLoad,
  peek: (id: string) => InteriorModel | undefined,
  settled: SettledLoad | null,
): InteriorLoad {
  if (!stationId) return NONE
  const id = interiorIdOf(stationId, index)
  if (!id) return NONE
  const model = peek(id)
  if (model) {
    if (!interiorCovers(model, stationId)) {
      const message = `stations/${id}.json does not cover ${stationId}`
      // Rendered every frame the station is focused; one log per pair is enough to show a deploy skew.
      if (!reportedUncovered.has(message)) {
        reportedUncovered.add(message)
        console.error(`${message}: the station index and the interior file disagree (a stale or mixed deploy?)`)
      }
      return { status: 'error', message }
    }
    return { status: 'ready', model }
  }
  if (settled?.id !== id) return LOADING
  return settled.load
}
