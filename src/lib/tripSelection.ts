/** Which of a plan's journeys is open in the trip panel, and the rules around it. Pure; no fetch, React or storage. */
import type { TripJourney } from './route/plan'
import type { TripTrigger } from './tripView'

/**
 * What a journey is, not which trains it rides: each ride's route, board and alight stops, each walk's stops. A
 * poll that swaps a scheduled train for its live twin (a new trip id) keeps the key, so the opened journey and
 * focus stay.
 */
export function journeyKey(j: TripJourney): string {
  return j.legs.map((l) => (l.kind === 'ride' ? `${l.routeId}:${l.boardStop}:${l.alightStop}` : `walk:${l.fromStop}:${l.toStop}`)).join('>')
}

/** The keys of a plan's journeys, in order. Two journeys with the same legs on different trains would share a key: the later ones get a suffix. */
export function journeyKeys(journeys: readonly TripJourney[]): string[] {
  const seen = new Map<string, number>()
  return journeys.map((j) => {
    const key = journeyKey(j)
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return n === 0 ? key : `${key}#${n}`
  })
}

/** The journey the visitor opened, and the plan (`TripPlanState.key`, the ends) it was opened in. */
export interface OpenedJourney {
  planKey: string
  key: string
  /** The panel opened it (the plan's only journey), not the visitor: losing it is no drop to tell about. */
  auto?: boolean
}

export type TripViewKind = 'none' | 'list' | 'detail'

export interface TripSelection {
  view: TripViewKind
  /** The key of the journey the detail view shows; null in the list and with none. */
  openedKey: string | null
  /** Index of the journey the map draws: the opened one, else the first (-1 with none). */
  selectedIndex: number
  /** The detail view has a list to go back to (more than one journey). */
  canGoBack: boolean
}

/** Which view shows, derived (never stored), so a plan that drops the opened journey never flashes it. */
export function tripSelection(keys: readonly string[], planKey: string | null, opened: OpenedJourney | null): TripSelection {
  if (keys.length === 0) return { view: 'none', openedKey: null, selectedIndex: -1, canGoBack: false }
  const index = opened !== null && opened.planKey === planKey ? keys.indexOf(opened.key) : -1
  if (index >= 0) return { view: 'detail', openedKey: keys[index]!, selectedIndex: index, canGoBack: keys.length > 1 }
  if (keys.length === 1) return { view: 'detail', openedKey: keys[0]!, selectedIndex: 0, canGoBack: false }
  return { view: 'list', openedKey: null, selectedIndex: 0, canGoBack: false }
}

/**
 * The opened journey after a plan settles: kept while the plan still offers it, auto-opened when it is the only
 * one, else cleared. `dropped` is set when a journey the visitor opened vanished from a refresh of the same ends (a
 * `tick` or `poll`); a retry is announced as a plan, and other ends are a new plan.
 */
export function reconcileOpened(
  opened: OpenedJourney | null,
  planKey: string,
  keys: readonly string[],
  trigger: TripTrigger,
): { opened: OpenedJourney | null; dropped: boolean } {
  const same = opened !== null && opened.planKey === planKey
  if (same && keys.includes(opened.key)) return { opened, dropped: false }
  const next = keys.length === 1 ? { planKey, key: keys[0]!, auto: true } : null
  if (next === null && opened === null) return { opened, dropped: false }
  return { opened: next, dropped: same && opened.auto !== true && (trigger === 'tick' || trigger === 'poll') }
}

/** What a screen reader hears when the opened journey left the plan; `remaining` is how many trips are offered now. */
export function droppedNote(remaining: number): string {
  const lead = 'The trip you opened is no longer offered.'
  if (remaining === 0) return `${lead} No other trip found.`
  if (remaining === 1) return `${lead} Showing the other trip.`
  return `${lead} Showing all ${remaining} trips.`
}

export type FocusTarget = { kind: 'detail' } | { kind: 'row'; key: string } | { kind: 'panel' }

/** Where focus goes when the view that held it is replaced: the detail's heading, the row left (if still listed), else the panel heading. */
export function focusAfterViewChange(view: TripViewKind, leftKey: string | null, keys: readonly string[]): FocusTarget {
  if (view === 'detail') return { kind: 'detail' }
  if (view === 'list' && leftKey !== null && keys.includes(leftKey)) return { kind: 'row', key: leftKey }
  return { kind: 'panel' }
}

/** The journeys with the selected one first, the rest in order; unchanged for null or one not in the list. */
export function selectedFirst<J>(journeys: readonly J[], selected: J | null): readonly J[] {
  if (selected === null) return journeys
  const at = journeys.indexOf(selected)
  return at <= 0 ? journeys : [selected, ...journeys.slice(0, at), ...journeys.slice(at + 1)]
}
