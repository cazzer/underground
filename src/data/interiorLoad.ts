import type { InteriorModel } from '../scene/interiorModel'

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

/**
 * What to show for station `id` (null: no interior to show). A cached model wins, so a revisit is
 * ready on its first render; a settled attempt for another station means this one is loading.
 */
export function deriveInteriorLoad(
  id: string | null,
  peek: (id: string) => InteriorModel | undefined,
  settled: SettledLoad | null,
): InteriorLoad {
  if (!id) return NONE
  const model = peek(id)
  if (model) return { status: 'ready', model }
  if (settled?.id !== id) return LOADING
  return settled.load
}
