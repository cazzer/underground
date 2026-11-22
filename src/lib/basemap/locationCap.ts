/**
 * The location zoom cap. A location fly-to frames the user's fix, so street-level tiles requested for that view
 * would tell the host where they are. From such a flight on, tiles load no finer than CAP_Z (several km a tile,
 * about a borough) until the user moves the view themselves or picks a station:
 *   - a pointer drag past the click slop (6 px mouse, 10 px touch, as ScenePicker), a second finger down (a pinch),
 *     or any wheel step;
 *   - a station pick (tap, panel row or search result: any station flight).
 * A tap that doesn't move, or the controls' `start` alone, does not lift it. Allocation-free per pointer move.
 */

export const CAP_Z = 12
export const MOVE_SLOP_PX = { mouse: 6, touch: 10 }

export type CapEvent =
  | { type: 'pointFlight' }
  | { type: 'station' }
  | { type: 'wheel' }
  | { type: 'down'; id: number; x: number; y: number; touch: boolean; primary: boolean }
  | { type: 'move'; id: number; x: number; y: number }
  | { type: 'up'; id: number }

interface Press {
  x: number
  y: number
  touch: boolean
}

export interface CapState {
  capped: boolean
  presses: Map<number, Press>
}

export function newCap(): CapState {
  return { capped: false, presses: new Map() }
}

/** Applies one event; returns true when it lifted the cap (the caller then picks tiles for the current view). */
export function capStep(state: CapState, e: CapEvent): boolean {
  switch (e.type) {
    case 'pointFlight':
      state.capped = true
      return false
    case 'station':
    case 'wheel':
      return lift(state)
    case 'down':
      // A primary pointer starts a fresh press: drop any left over from presses that ended off the window.
      if (e.primary) state.presses.clear()
      state.presses.set(e.id, { x: e.x, y: e.y, touch: e.touch })
      return state.presses.size > 1 ? lift(state) : false
    case 'move': {
      const p = state.presses.get(e.id)
      if (!p) return false
      return Math.hypot(e.x - p.x, e.y - p.y) > MOVE_SLOP_PX[p.touch ? 'touch' : 'mouse'] ? lift(state) : false
    }
    case 'up':
      state.presses.delete(e.id)
      return false
  }
}

function lift(state: CapState): boolean {
  if (!state.capped) return false
  state.capped = false
  return true
}
