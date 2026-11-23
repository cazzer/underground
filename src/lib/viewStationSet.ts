/**
 * The stations in view as one shared object (o3r.2), the way `locationCapHandle.ts` shares the location cap: the scene
 * hook `useViewStations` writes it, and anything that draws or fetches by view (o3r.4) reads it through
 * `useSyncExternalStore`, so a change re-renders only its readers, never the whole app. Scene keeps two, one for the
 * stations in view and one for those to prefetch (o3r.8). Pure. `get` returns the last
 * set (station leads, the focused one first when there is one), the same array until it changes.
 */

export type ViewStationListener = (ids: readonly string[]) => void

export interface ViewStationSet {
  /** The station leads in view now; stable between changes, empty before the first choice and under the location cap. */
  get(): readonly string[]
  /** Calls `listener` each time `set` stores a new list. Returns the unsubscribe. Listeners must not throw (one that does is logged and skipped). */
  subscribe(listener: ViewStationListener): () => void
  /** Stores `ids` and tells the listeners (the scene hook's job; call it only on a change). */
  set(ids: readonly string[]): void
}

const NONE: readonly string[] = []

export function createViewStationSet(): ViewStationSet {
  let ids = NONE
  const listeners = new Set<ViewStationListener>()
  return {
    get: () => ids,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next) {
      ids = next
      // Each listener runs on its own, so one that throws (a bug, logged) never stops the others or the writer.
      for (const l of listeners) {
        try {
          l(next)
        } catch (err) {
          console.error('View stations listener threw', err)
        }
      }
    },
  }
}
