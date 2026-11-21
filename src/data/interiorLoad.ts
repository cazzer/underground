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

const NONE: InteriorLoad = { status: 'none' }
const LOADING: InteriorLoad = { status: 'loading' }

/** The station index (public/data/stations/index.json): which stations have an interior file. */
export type IndexLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; index: StationIndex }

/** The station's id when the index is ready and lists it; otherwise null. */
export function interiorIdOf(stationId: string | null, index: IndexLoad): string | null {
  if (!stationId || index.status !== 'ready') return null
  return Object.hasOwn(index.index.stations, stationId) ? stationId : null
}

/**
 * What to show for station `stationId` (null: no station focused). Until the index is ready, or if it
 * failed, there is nothing to say about the station (almost no station has an interior, so a panel
 * would be wrong for nearly all of them); a station the index doesn't list has none either. Then a
 * cached model wins, so a revisit is ready on its first render, and a settled attempt for another
 * station means this one is loading.
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
  if (model) return { status: 'ready', model }
  if (settled?.id !== id) return LOADING
  return settled.load
}
