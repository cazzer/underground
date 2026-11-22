/**
 * The collapse reframe: a user collapse or expand of the panel in front (panelCollapse.tsx's `seq`, never the panel's
 * size) reframes the focused station onto its priority frame (pathFrame.ts: the trip's path there, the machines out of
 * service; a bare station's point and entrance marks) in the free area the panel now leaves. It waits for the panel's
 * measurement to settle, so one toggle is one move, and moves only when the view doesn't already frame all of it and
 * the new framing shows no less than the view does. Pure; useCollapseReframe applies it.
 */
import { showsMore } from './pathFrame'

/** The panel's measurement is settled once it has held this long... */
export const COLLAPSE_QUIET_MS = 150
/** ...or this long after the toggle, whichever comes first. */
export const COLLAPSE_MAX_WAIT_MS = 600

/** A toggle waiting for the panel to settle. A gesture, another flight or a follow clears it; while set, the late-interior reframe waits. */
export interface CollapsePending {
  /** The station focused at the toggle. */
  stationId: string
  /** performance.now() at the toggle, ms. */
  bumpedAt: number
  /** performance.now() at the panel's last measured move since the toggle (bumpedAt until one comes), ms. */
  panelAt: number
  /** Under reduced motion the reframe snaps. */
  reduced: boolean
}

/** Milliseconds until the pending toggle reframes: the panel quiet for COLLAPSE_QUIET_MS, at most COLLAPSE_MAX_WAIT_MS after the toggle; 0 when due. */
export function collapseDueIn(p: CollapsePending, nowMs: number): number {
  return Math.max(0, Math.min(p.panelAt + COLLAPSE_QUIET_MS, p.bumpedAt + COLLAPSE_MAX_WAIT_MS) - nowMs)
}

/**
 * Whether moving from the view (`current`: how many of each priority tier it frames now) to the new framing (`next`)
 * is worth it: not when the view already frames every point (`totals`), nor when it shows more than the new framing
 * would. On a tie the new framing wins: it is the landing this panel layout would get, which an expand returns to
 * when the path can't show above the panel either way.
 */
export function reframeGains(current: readonly number[], next: readonly number[], totals: readonly number[]): boolean {
  if (current.every((n, i) => n >= totals[i]!)) return false
  return !showsMore(current, next)
}

export interface CollapseInput {
  flying: boolean
  following: boolean
  focusedId: string | null
}

/** drop: forget it (another flight, a follow, or the focus moved on). reframe: an eased flight, no turn. snap: the same at once. */
export type CollapseAction = 'drop' | 'reframe' | 'snap'

export function collapseAction(p: CollapsePending, s: CollapseInput): CollapseAction {
  if (s.flying || s.following || s.focusedId !== p.stationId) return 'drop'
  return p.reduced ? 'snap' : 'reframe'
}
