/**
 * The collapse reframe: a user collapse or expand of the panel in front (panelCollapse.tsx's `seq`, never the panel's
 * size) reframes the focused station onto its priority frame (pathFrame.ts: the trip's path there, the machines out of
 * service; a bare station's point and entrance marks; an interior with neither, its usual landing) in the free area the
 * panel now leaves. It waits for the panel's measurement to settle, so one toggle is one move, and moves only when the
 * view doesn't already frame all of it and the new framing shows no less than the view does. It declines once the user
 * has taken over the view (a gesture since the last landing) and while a late interior or streets reframe is pending
 * (useInteriorReframe's own, which decides the landing turn).
 *
 * A bare station's phone panel that grows (or shrinks) after its landing, the Entrances row arriving with the streets
 * file or a "Show all" opened, settles the same way and reframes onto its entrance marks in the free area left, but only
 * while the user hasn't taken the view over and only when the new framing shows strictly more (ost.18). An interior's
 * panel size alone never moves the camera. Pure; useCollapseReframe applies it.
 */
import { showsMore } from './pathFrame'

/** The panel's measurement is settled once it has held this long... */
export const COLLAPSE_QUIET_MS = 150
/** ...or this long after the toggle, whichever comes first. */
export const COLLAPSE_MAX_WAIT_MS = 600

/** A toggle waiting for the panel to settle. A gesture, another flight or a follow clears it; while set, the late-interior reframe waits. */
export interface CollapsePending {
  /** toggle: a user collapse or expand. resize: a bare station's panel that changed size after its landing. */
  kind: 'toggle' | 'resize'
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

/** Whether a move is worth it: a toggle by reframeGains; a resize only when the new framing shows strictly more (the station first, then marks). */
export function moveGains(kind: CollapsePending['kind'], current: readonly number[], next: readonly number[], totals: readonly number[]): boolean {
  return kind === 'toggle' ? reframeGains(current, next, totals) : showsMore(next, current)
}

export interface PanelMoveInput {
  flying: boolean
  following: boolean
  tookOver: boolean
  /** A late interior or streets reframe is pending: it reads the panel as it then is. */
  lateArrival: boolean
  focusedId: string | null
  /** The station of the last station flight, while the station panel has stayed in front since; else null. */
  flownId: string | null
  /** The index lists no interior for the focused station. */
  bare: boolean
  /** The free rect's bottom (interiorFreeRect) at the panel's previous and new measure, px; null with no panel. */
  before: number | null
  after: number | null
  /** The viewport is the same at both measures: a resize or a rotation keeps the user's view. */
  sameViewport: boolean
}

/**
 * Whether a measured move of the panel arms a resize reframe: a landed bare station (its own flight, no gesture since,
 * no flight or follow now, no late streets pending) whose free area changed height. A side panel (desktop) never
 * changes the free rect's bottom, so it never arms.
 */
export function panelMoveArms(s: PanelMoveInput): boolean {
  if (s.flying || s.following || s.tookOver || s.lateArrival || !s.bare) return false
  if (s.focusedId === null || s.flownId !== s.focusedId) return false
  if (s.before === null || s.after === null || !s.sameViewport) return false
  return Math.abs(s.after - s.before) >= 0.5
}

export interface CollapseInput {
  flying: boolean
  following: boolean
  focusedId: string | null
  /** A gesture since the last landing: the user took the view over, so a toggle leaves it where it is. */
  tookOver: boolean
  /** The landing awaits a late interior or a bare station's streets (AwaitingInterior kind 'interior' or 'streets'): that reframe moves once, with its turn. */
  lateArrival: boolean
  /** The index lists no interior for the pending station: a resize reframes only a bare station. */
  bare: boolean
}

/**
 * drop: forget it (another flight, a follow, the focus moved on, the user took over, or a late-arrival reframe is
 * pending; for a resize, a station with an interior). reframe: an eased flight, no turn. snap: the same at once.
 */
export type CollapseAction = 'drop' | 'reframe' | 'snap'

export function collapseAction(p: CollapsePending, s: CollapseInput): CollapseAction {
  if (s.flying || s.following || s.tookOver || s.lateArrival || s.focusedId !== p.stationId) return 'drop'
  if (p.kind === 'resize' && !s.bare) return 'drop'
  return p.reduced ? 'snap' : 'reframe'
}
