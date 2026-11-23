import { MAX_VIEW_INTERIORS } from '../lib/viewStations'
import type { InteriorModel } from '../scene/interiorModel'
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

/** What a station's interior is: hand-authored, generated, none, or null while the station index isn't ready (nothing is known). */
export type StationLayout = 'authored' | 'generated' | 'none' | null

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

/** The fields of an interior the view helpers read (InteriorModel has them). */
interface CoversStations {
  stationId: string
  memberStationIds?: readonly string[]
}

const NO_FILES: readonly string[] = Object.freeze([])

/**
 * The interior file ids to load for the stations in view (`view`: o3r.2's leads, focused first), other than the focused
 * station's: in view order, each file once, stations the index doesn't list skipped, and files `skip` names (one that
 * failed lately) passed over without taking a slot; at most `max` files with the focused one's counted (its slot is kept
 * while it loads or after it fails, so the set doesn't swap as it lands). Empty until the index is ready. Only ids in
 * `view` ever appear, so the fetch follows the camera and nothing else.
 */
export function viewInteriorIds(
  view: readonly string[],
  focusedId: string | null,
  index: IndexLoad,
  max = MAX_VIEW_INTERIORS,
  skip: (file: string) => boolean = () => false,
): readonly string[] {
  if (index.status !== 'ready') return NO_FILES
  const focusedFile = interiorIdOf(focusedId, index)
  const room = max - (focusedFile ? 1 : 0)
  const out: string[] = []
  for (const id of view) {
    if (out.length >= room) break
    const file = interiorIdOf(id, index)
    if (file === null || file === focusedFile || out.includes(file) || skip(file)) continue
    out.push(file)
  }
  return out.length > 0 ? out : NO_FILES
}

const reportedUnknown = new Set<string>()

/**
 * The interiors the scene draws: the focused one first, then `others` in order, each file once, at most `max`. A model
 * covering a station the map lacks (`known` rejects it, a stale or mixed deploy) is left out with one warning per file,
 * since its spans, markers and camera all look its stations up.
 */
export function drawnInteriors<T extends CoversStations>(
  focused: T | null,
  others: readonly T[],
  known: (id: string) => boolean,
  max = MAX_VIEW_INTERIORS,
): readonly T[] {
  const out: T[] = []
  for (const m of focused ? [focused, ...others] : others) {
    if (out.length >= max) break
    if (out.some((o) => o.stationId === m.stationId)) continue
    const unknown = interiorStationIds(m).find((id) => !known(id))
    if (unknown !== undefined) {
      if (!reportedUnknown.has(m.stationId)) {
        reportedUnknown.add(m.stationId)
        console.warn(`Interior ${m.stationId} covers unknown station "${unknown}"; not drawn (the data files disagree)`)
      }
      continue
    }
    out.push(m)
  }
  return out
}

/** Every station the interiors cover, each once, in order. */
export function coveredStationIds(models: readonly CoversStations[]): readonly string[] {
  if (models.length === 0) return NO_SIBLINGS
  return [...new Set(models.flatMap((m) => interiorStationIds(m)))]
}
