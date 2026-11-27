/** The opened journey as an itinerary: Board, Change and Exit steps between its ride and walk rows, each with its status and one spoken sentence. Pure. */
import type { StationLayout } from '../data/interiorLoad'
import type { PlaceWalkInfo, PlaceWalkInfos } from './placeWalk'
import type { ChangeLegView, LegView, RideLegView } from './tripView'

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
  /** The walk between a searched place and the station: leading at From, trailing at To. Plain text, no step. */
  | { kind: 'place'; end: 'from' | 'to'; text: string; spoken: string }
  /**
   * `showOff`: the ride row says when it gets off (the next row is not the Exit step, which has the time). `offPlace`:
   * and where, when a walk follows (the next row is a walk, not a Change or Board step that names the station).
   */
  | { kind: 'leg'; leg: LegView; index: number; showOff: boolean; offPlace: string | null }

export interface StepContext {
  layoutOf: (stationId: string) => StationLayout
  /** "4", "FX": the route as the chip shows it. */
  routeName: (routeId: string) => string
  /** "4", "F express": how a screen reader says the route. */
  routeSpoken: (routeId: string) => string
  /** The first Board step has a path drawn at its station. */
  hasBoardPath: boolean
  /** The journey's exit line exists, by the last ride's trip id. */
  hasExitPath: (tripId: string) => boolean
  /** The change has a transfer line, by its `transferKey`. */
  hasTransferPath: (transferKey: string) => boolean
  /** The trip end filled from the location fix and not yet picked or focused (`fixEnd`): its way in or out is not
   *  looked up until the visitor taps its step. */
  fixPending: 'from' | 'to' | null
  /** The From station's layout has no way in to the first train's track (every entrance to it is exit-only). */
  noWayIn: boolean
  /** The walks to and from the places the ends were searched from, for the journey the map draws; none for any other. */
  placeWalks: PlaceWalkInfos
}

const NO_LAYOUT = 'No station layout'
const NO_CHANGE_PATH = 'No path shown for this change'
const TAP_IN = 'Tap to show the way in'
const TAP_OUT = 'Tap to show the way out'
const NO_WAY_IN = 'No way in on the layout'

/**
 * What a step says it cannot show. Nothing while the layout is not known (null) or a path exists. A change at a
 * generated station has a layout but no path to draw (generated interiors never connect two tracks); a Board or Exit
 * at one may simply still be loading, so it says nothing.
 */
export function stepStatus(kind: StepKind, layout: StationLayout, hasPath: boolean): string | null {
  if (hasPath || layout === null) return null
  if (layout === 'none') return NO_LAYOUT
  if (kind === 'change' && layout === 'generated') return NO_CHANGE_PATH
  return null
}

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
  /** What the step says in place of a path at a station with a layout; null for `stepStatus`'s rule. */
  note: string | null
  transferKey: string | null
  tripId: string | null
}

function boardDraft(ride: RideLegView, index: number, ctx: StepContext, first: boolean): Draft {
  const { stationId, name, clock } = ride.board
  // Only a journey that starts on this ride boards at the From station.
  const atFrom = first && index === 0
  return {
    kind: 'board',
    legIndex: index,
    stationId,
    name,
    clock,
    text: `Board ${clock} at ${name}`,
    sentence: `board the ${ctx.routeSpoken(ride.routeId)} at ${name}, ${clock}`,
    hasPath: first && ctx.hasBoardPath,
    note: atFrom && ctx.fixPending === 'from' ? TAP_IN : atFrom && ctx.noWayIn ? NO_WAY_IN : null,
    transferKey: null,
    tripId: null,
  }
}

/** `last`: the ride is the journey's last leg, so its alight station is where the exit line is; a trailing walk moves the way out elsewhere. */
function exitDraft(ride: RideLegView, index: number, last: boolean, ctx: StepContext): Draft {
  const { stationId, name, clock } = ride.alight
  return {
    kind: 'exit',
    legIndex: index,
    stationId,
    name,
    clock,
    text: `Exit ${clock} at ${name}`,
    sentence: `exit at ${name}, ${clock}`,
    hasPath: last && ctx.hasExitPath(ride.tripId),
    note: last && ctx.fixPending === 'to' ? TAP_OUT : null,
    transferKey: null,
    tripId: last ? ride.tripId : null,
  }
}

function changeDraft(leg: ChangeLegView, index: number, next: RideLegView | undefined, ctx: StepContext): Draft {
  const { minutes } = leg
  const to = next ? { visible: ` · ${ctx.routeName(next.routeId)} train at ${next.board.clock}`, spoken: ` to the ${ctx.routeSpoken(next.routeId)} train at ${next.board.clock}` } : null
  return {
    kind: 'change',
    legIndex: index,
    stationId: leg.stationId,
    name: leg.name,
    clock: null,
    text: `Change at ${leg.name}${minutes === null ? '' : ` · ${minutes} min walk`}${to?.visible ?? ''}`,
    sentence: `change at ${leg.name}${to?.spoken ?? ''}${minutes === null ? '' : `, a ${minutes}-minute walk`}`,
    hasPath: ctx.hasTransferPath(leg.transferKey),
    note: null,
    transferKey: leg.transferKey,
    tripId: null,
  }
}

function finish(drafts: readonly Draft[], ctx: StepContext): Map<string, TripStep> {
  const steps = new Map<string, TripStep>()
  drafts.forEach((d, i) => {
    const layout = ctx.layoutOf(d.stationId)
    const status = !d.hasPath && d.note !== null && layout !== null && layout !== 'none' ? d.note : stepStatus(d.kind, layout, d.hasPath)
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
 * come before the first Board. A walk-only journey has no steps. The walks to and from a searched place are plain rows
 * before the first and after the last.
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
      if (i === lastRide) drafts.push(exitDraft(leg, i, i === legs.length - 1, ctx))
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
    else {
      const showOff = leg.kind === 'ride' && exit === undefined
      rows.push({ kind: 'leg', leg, index: i, showOff, offPlace: leg.kind === 'ride' && showOff && legs[i + 1]?.kind === 'walk' ? leg.alight.name : null })
    }
    if (exit) rows.push({ kind: 'step', step: exit })
  })
  // The walks to and from a searched place bracket the journey: the From walk leads, the To walk trails.
  if (ctx.placeWalks.from) rows.unshift(placeRow('from', ctx.placeWalks.from, endStationName(legs, 'from')))
  if (ctx.placeWalks.to) rows.push(placeRow('to', ctx.placeWalks.to, endStationName(legs, 'to')))
  return rows
}

const minutesText = (n: number): string => `${n} minute${n === 1 ? '' : 's'}`

/** The row for a place walk: "Walk to Bedford Av & N 4 St · 3 min" at To, "Walk from …" at From, "about" for an estimate. */
function placeRow(end: 'from' | 'to', w: PlaceWalkInfo, station: string): ItineraryRow {
  const about = w.estimated ? 'about ' : ''
  const text = `Walk ${end === 'from' ? 'from' : 'to'} ${w.place} · ${about}${w.minutes} min`
  const spoken =
    end === 'from'
      ? `Walk ${about}${minutesText(w.minutes)} from ${w.place} to ${station}.`
      : `Walk ${about}${minutesText(w.minutes)} from ${station} to ${w.place}.`
  return { kind: 'place', end, text, spoken }
}

/** The station a journey starts or ends at, for the place walk's sentence: its first or last leg's. */
function endStationName(legs: readonly LegView[], end: 'from' | 'to'): string {
  const leg = end === 'from' ? legs[0] : legs.at(-1)
  if (leg?.kind === 'ride') return end === 'from' ? leg.board.name : leg.alight.name
  if (leg?.kind === 'walk') return end === 'to' ? leg.to : leg.from
  return leg?.kind === 'change' ? leg.name : 'the station'
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
