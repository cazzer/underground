/** The opened journey as an itinerary: Board, Change and Exit steps between its ride and walk rows, each with its status and one spoken sentence. Pure. */
import type { ChangeLegView, LegView, RideLegView } from './tripView'

/** What a station's interior is: hand-authored, generated, none, or null while the station index isn't ready (nothing is known). */
export type StationLayout = 'authored' | 'generated' | 'none' | null

export type StepKind = 'board' | 'change' | 'exit'

export interface TripStep {
  /** `${kind}:${leg index}`, stable across refreshes of the same journey. */
  key: string
  kind: StepKind
  /** The station the step flies to (a complex member; `select` maps it to the lead). */
  stationId: string
  name: string
  /** The time of a Board or Exit step; null for a Change. */
  clock: string | null
  /** The visible line: "Board 8:04 at Bedford Av". */
  text: string
  /** The dim line under it when the station has no layout to show; null for none (or not known yet). */
  status: string | null
  /** The one sentence a screen reader hears, with its status. */
  spoken: string
  /** Change only: `transferKey` of the change, the transfer line's key. */
  transferKey: string | null
  /** Exit only: the trip id of the last ride, the exit line's key. */
  tripId: string | null
}

export type ItineraryRow =
  | { kind: 'step'; step: TripStep }
  /** `showOff`: the ride row says when it gets off (the next row is not the Exit step, which has the time). */
  | { kind: 'leg'; leg: LegView; index: number; showOff: boolean }

export interface StepContext {
  layoutOf: (stationId: string) => StationLayout
  /** "L", "F express": how a screen reader says the route. */
  routeSpoken: (routeId: string) => string
  /** The first Board step has a path drawn at its station. */
  hasBoardPath: boolean
  /** The journey's exit line exists, by the last ride's trip id. */
  hasExitPath: (tripId: string) => boolean
  /** The change has a transfer line, by its `transferKey`. */
  hasTransferPath: (transferKey: string) => boolean
}

const NO_LAYOUT = 'No station layout'
const NO_CHANGE_LAYOUT = 'No station layout for this change'

/**
 * What a step says it cannot show. Nothing while the layout is not known (null) or a path exists. A change at a
 * generated station has no path to draw (generated interiors never connect two tracks); a Board or Exit at one may
 * simply still be loading, so it says nothing.
 */
export function stepStatus(kind: StepKind, layout: StationLayout, hasPath: boolean): string | null {
  if (hasPath || layout === null) return null
  if (layout === 'none') return NO_LAYOUT
  if (kind === 'change' && layout === 'generated') return NO_CHANGE_LAYOUT
  return null
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

interface Draft {
  kind: StepKind
  legIndex: number
  stationId: string
  name: string
  clock: string | null
  text: string
  /** "board the L at Bedford Av at 8:04": the sentence's body. */
  sentence: string
  hasPath: boolean
  transferKey: string | null
  tripId: string | null
}

function boardDraft(ride: RideLegView, index: number, ctx: StepContext, first: boolean): Draft {
  const { stationId, name, clock } = ride.board
  return {
    kind: 'board',
    legIndex: index,
    stationId,
    name,
    clock,
    text: `Board ${clock} at ${name}`,
    sentence: `board the ${ctx.routeSpoken(ride.routeId)} at ${name} at ${clock}`,
    hasPath: first && ctx.hasBoardPath,
    transferKey: null,
    tripId: null,
  }
}

function exitDraft(ride: RideLegView, index: number, ctx: StepContext): Draft {
  const { stationId, name, clock } = ride.alight
  return {
    kind: 'exit',
    legIndex: index,
    stationId,
    name,
    clock,
    text: `Exit ${clock} at ${name}`,
    sentence: `exit at ${name} at ${clock}`,
    hasPath: ctx.hasExitPath(ride.tripId),
    transferKey: null,
    tripId: ride.tripId,
  }
}

function changeDraft(leg: ChangeLegView, index: number, next: RideLegView | undefined, ctx: StepContext): Draft {
  const { minutes } = leg
  return {
    kind: 'change',
    legIndex: index,
    stationId: leg.stationId,
    name: leg.name,
    clock: null,
    text: `Change at ${leg.name}${minutes === null ? '' : ` · ${minutes} min`}`,
    sentence: `change at ${leg.name}${next ? ` to the ${ctx.routeSpoken(next.routeId)}` : ''}${minutes === null ? '' : `, ${plural(minutes, 'minute')}`}`,
    hasPath: ctx.hasTransferPath(leg.transferKey),
    transferKey: leg.transferKey,
    tripId: null,
  }
}

function finish(drafts: readonly Draft[], ctx: StepContext): Map<string, TripStep> {
  const steps = new Map<string, TripStep>()
  drafts.forEach((d, i) => {
    const status = stepStatus(d.kind, ctx.layoutOf(d.stationId), d.hasPath)
    const key = `${d.kind}:${d.legIndex}`
    steps.set(key, {
      key,
      kind: d.kind,
      stationId: d.stationId,
      name: d.name,
      clock: d.clock,
      text: d.text,
      status,
      spoken: `Step ${i + 1} of ${drafts.length}: ${d.sentence}.${status !== null ? ` ${status}.` : ''}`,
      transferKey: d.transferKey,
      tripId: d.tripId,
    })
  })
  return steps
}

/**
 * The journey's rows in travel order. A Board step comes before the first ride and before any ride that follows a plain
 * walk between stations (the walk stays its own row), a Change step replaces each change leg and names the next
 * train, and the Exit step follows the last ride at its alight station, with a trailing walk after it. Leading walks
 * come before the first Board. A walk-only journey has no steps.
 */
export function journeyItinerary(legs: readonly LegView[], ctx: StepContext): ItineraryRow[] {
  const drafts: Draft[] = []
  let lastRide = -1
  legs.forEach((l, i) => {
    if (l.kind === 'ride') lastRide = i
  })
  let seenRide = false
  legs.forEach((leg, i) => {
    if (leg.kind === 'ride') {
      if (!seenRide || legs[i - 1]?.kind === 'walk') drafts.push(boardDraft(leg, i, ctx, !seenRide))
      seenRide = true
      if (i === lastRide) drafts.push(exitDraft(leg, i, ctx))
    } else if (leg.kind === 'change') {
      drafts.push(changeDraft(leg, i, legs.slice(i + 1).find((l): l is RideLegView => l.kind === 'ride'), ctx))
    }
  })
  const steps = finish(drafts, ctx)
  const rows: ItineraryRow[] = []
  legs.forEach((leg, i) => {
    const [board, change, exit] = [steps.get(`board:${i}`), steps.get(`change:${i}`), steps.get(`exit:${i}`)]
    if (board) rows.push({ kind: 'step', step: board })
    if (change) rows.push({ kind: 'step', step: change })
    else rows.push({ kind: 'leg', leg, index: i, showOff: leg.kind === 'ride' && exit === undefined })
    if (exit) rows.push({ kind: 'step', step: exit })
  })
  return rows
}

/** The stored step as active: only while the opened journey and the focused station are still the ones it was pressed on. */
export function activeStepKey(
  stored: { journeyKey: string | null; key: string; leadId: string } | null,
  openedKey: string | null,
  focusedId: string | null,
): string | null {
  if (stored === null || openedKey === null || stored.journeyKey !== openedKey || stored.leadId !== focusedId) return null
  return stored.key
}
