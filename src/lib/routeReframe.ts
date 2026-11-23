/**
 * The route frame's reframes after its landing (2q7.45.5). The trip panel in front, the route flight the last landing
 * and no gesture since: a user collapse or expand of the panel (panelCollapse.tsx's `seq`), or one measured panel
 * move that shifts the free rect's bottom inside RESIZE_WINDOW_MS of the landing (a phone panel growing a line), waits
 * for the panel's measurement to settle (collapseDueIn) and reframes once onto the route in the new free rect. These
 * reuse the station collapse's settle and window rules (collapseReframe.ts, resizeReframe.ts) under one fixed id.
 * Pure; useRouteReframe applies it.
 */
import type { CollapseAction, CollapsePending } from './collapseReframe'
import { panelMoveArms, RESIZE_WINDOW_MS, type PanelMoveInput, type ResizeWindow } from './resizeReframe'

/** Stands in for the station id the shared rules key on. */
export const ROUTE_ID = 'route'

/** A reframe waiting for the panel to settle (read by `collapseDueIn`). */
export function routePending(kind: CollapsePending['kind'], nowMs: number, reduced: boolean): CollapsePending {
  return { kind, stationId: ROUTE_ID, bumpedAt: nowMs, panelAt: nowMs, reduced }
}

/** What the route flight's landing leaves: when it landed (performance.now(), ms) and the viewport it framed in. */
export interface RouteLanded {
  landedAt: number
  width: number
  height: number
}

/** Whether a move of the free rect's bottom from `before` to `after` (px) arms a reframe inside the landing's window. `open` is false once it was used or a press closed it. */
export function routeMoveArms(landed: RouteLanded, open: boolean, s: Omit<PanelMoveInput, 'focusedId' | 'lateArrival'>): boolean {
  const w: ResizeWindow | null = open ? { stationId: ROUTE_ID, until: landed.landedAt + RESIZE_WINDOW_MS, width: landed.width, height: landed.height } : null
  return panelMoveArms(w, { ...s, focusedId: ROUTE_ID, lateArrival: false })
}

export interface RouteReframeInput {
  flying: boolean
  following: boolean
  /** A gesture since the last landing. */
  tookOver: boolean
  /** The route flight was the last landing. */
  landed: boolean
  /** The trip panel is in front. */
  front: boolean
  reduced: boolean
}

/** drop: leave the view alone. reframe: an eased flight, no turn. snap: the same at once. */
export function routeReframeAction(s: RouteReframeInput): CollapseAction {
  if (s.flying || s.following || s.tookOver || !s.landed || !s.front) return 'drop'
  return s.reduced ? 'snap' : 'reframe'
}
