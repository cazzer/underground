/**
 * The location zoom cap as one shared object (o3r.1): the `locationCap.ts` machine plus a ref-style read and change
 * subscription, so the basemap's tile store and any other view-driven fetch can honor the same cap. Pure; the scene
 * hook `useLocationCap` feeds it the fly request and the pointer events. `isCapped` allocates nothing and never
 * re-renders anything; listeners run only when the cap goes on or off.
 */
import { capStep, newCap, type CapEvent } from './locationCap'

export type CapListener = (capped: boolean) => void

export interface LocationCap {
  /** Whether the cap is in force now. */
  isCapped(): boolean
  /** Calls `listener` each time the cap goes on (true) or is lifted (false), not on events that change nothing. Returns the unsubscribe. Listeners must not throw (one that does is logged and skipped). */
  subscribe(listener: CapListener): () => void
  /** Feeds the machine one event (the scene hook's job). */
  step(e: CapEvent): void
}

export function createLocationCap(): LocationCap {
  const state = newCap()
  const listeners = new Set<CapListener>()
  // Each listener runs on its own, so one that throws (a bug, logged) never stops the others or the caller's effect.
  const emit = () => {
    for (const l of listeners) {
      try {
        l(state.capped)
      } catch (err) {
        console.error('Location cap listener threw', err)
      }
    }
  }
  return {
    isCapped: () => state.capped,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    step(e) {
      const was = state.capped
      capStep(state, e)
      if (was !== state.capped) emit()
    },
  }
}
