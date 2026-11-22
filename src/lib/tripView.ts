/** What the trip panel shows: the ends, the plan's states, messages and journey views. Pure; no fetch, React or storage. */
import type { RouteId, StationId } from '../data/schema'
import { routeSpokenName } from './labels'
import { stationOfStop } from './live/arrivals'
import { clockNow } from './live/clock'
import { nyClockTime, stopEta, stopEtaSpoken } from './live/trainStops'
import type { Placement } from './locate'
import type { OverlayCounts } from './route/overlay'
import type { TripJourney, TripRideLeg } from './route/plan'

export interface TripEnds {
  from: StationId | null
  to: StationId | null
}

/** Why a plan ran: new ends, the 30 s refresh or a new live snapshot (both silent), or the Retry button. */
export type TripTrigger = 'ends' | 'tick' | 'poll' | 'retry'

interface Settled {
  /** `tripKey` of the ends it answers. */
  key: string
  /** Counts runs the visitor caused (new ends, retry); a refresh keeps its predecessor's. */
  attempt: number
  trigger: TripTrigger
}

export type TripPlanState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  /** `sameStation`: both ends are in one complex, so there is nothing to plan. */
  | ({ status: 'ready'; atS: number; journeys: TripJourney[]; sameStation?: boolean; overlay?: OverlayCounts | null } & Settled)
  | ({ status: 'noService'; date: string } & Settled)
  | ({ status: 'error'; message: string } & Settled)

export const tripKey = (from: StationId, to: StationId): string => `${from}>${to}`

/** A station pair worth planning: both set and different. */
export function plannable(ends: TripEnds): ends is { from: StationId; to: StationId } {
  return ends.from !== null && ends.to !== null && ends.from !== ends.to
}

/**
 * The ends to start from. A marked fix (near or far) makes the nearest station From, and the focused station To
 * when it differs; with no fix the focused station is From. An outside fix is ignored: it names no marker.
 */
export function defaultEnds(focusedId: string | null, placement: Placement | null): TripEnds {
  if (placement && placement.kind !== 'outside') {
    const from = placement.nearest.id
    return { from, to: focusedId !== null && focusedId !== from ? focusedId : null }
  }
  return { from: focusedId, to: null }
}

/** Epoch seconds now: the live clock once a snapshot has set it, else the device clock (schedule only). */
export function tripNowS(source: { offsetS: number } | null, perfMs: number, dateMs: number): number {
  return source ? clockNow(source.offsetS, perfMs) : dateMs / 1000
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "20261201" to "Tue, Dec 1". */
function formatDate(yyyymmdd: string): string {
  const [y, m, d] = [Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)), Number(yyyymmdd.slice(6, 8))]
  return DATE_FORMAT.format(new Date(Date.UTC(y, m - 1, d)))
}

/**
 * The line under the ends, or null when there is nothing to say (journeys are shown, or a plan is still quiet:
 * "Finding trips…" waits for `showLoading`, so a fast plan never flashes it). A plan for other ends counts as none.
 */
export function tripMessage(ends: TripEnds, plan: TripPlanState, showLoading: boolean): string | null {
  if (ends.from === null) return 'Choose a starting station'
  if (ends.to === null) return 'Choose a destination'
  if (ends.from === ends.to) return 'From and To are the same station'
  const current = plan.status !== 'idle' && plan.key === tripKey(ends.from, ends.to) ? plan : null
  if (current === null || current.status === 'loading') return showLoading ? 'Finding trips…' : null
  switch (current.status) {
    case 'noService':
      return `No timetable for ${formatDate(current.date)}. The schedule may be out of date.`
    case 'error':
      return "Couldn't load the timetable"
    case 'ready':
      if (current.sameStation) return 'From and To are the same station'
      return current.journeys.length === 0 ? 'No trip found between these stations' : null
  }
}

/** Soonest arrival first, then fewest transfers, then earliest departure. */
export function orderJourneys(journeys: readonly TripJourney[]): TripJourney[] {
  return [...journeys].sort((a, b) => a.arriveAt - b.arriveAt || a.transfers - b.transfers || a.departAt - b.departAt)
}

export interface TripNames {
  station: (id: StationId) => string
  /** The route's short name ("L", "4", "FX"). */
  route: (id: RouteId) => string
}

interface PlaceTime {
  stationId: StationId
  name: string
  clock: string
}
export interface RideLegView {
  kind: 'ride'
  routeId: RouteId
  tripId: string
  /** The leg's times are realtime predictions. */
  live: boolean
  /** The train's destination: the pattern's last stop, which may lie past where the rider gets off. */
  headsign: string
  board: PlaceTime
  alight: PlaceTime
  stopsText: string
}
/** A change of trains inside one station; `minutes` is null for a same-platform change (0 s). */
export interface ChangeLegView {
  kind: 'change'
  stationId: StationId
  name: string
  minutes: number | null
}
export interface WalkLegView {
  kind: 'walk'
  toStationId: StationId
  to: string
  minutes: number
}
export type LegView = RideLegView | ChangeLegView | WalkLegView

/** Where a journey's times come from: every train live, some, or none. */
export type JourneySource = 'live' | 'mixed' | 'scheduled'
const SOURCE_TEXT: Record<JourneySource, string> = { live: 'Live', mixed: 'Live and scheduled', scheduled: 'Scheduled' }

/**
 * What a journey is, not which trains it rides: each ride's route, board and alight stops, each walk's stops. A
 * poll that swaps a scheduled train for its live twin (a new trip id) keeps the key, so the disclosure the visitor
 * toggled, and focus inside it, stay put.
 */
export function journeyKey(j: TripJourney): string {
  return j.legs.map((l) => (l.kind === 'ride' ? `${l.routeId}:${l.boardStop}:${l.alightStop}` : `walk:${l.fromStop}:${l.toStop}`)).join('>')
}

/** A journey's source by its ride legs (a walk-only journey has no train to be live). */
export function journeySource(j: TripJourney): JourneySource {
  const rides = j.legs.filter((l): l is TripRideLeg => l.kind === 'ride')
  const live = rides.filter((r) => r.live).length
  if (live === 0) return 'scheduled'
  return live === rides.length ? 'live' : 'mixed'
}

export interface JourneyView {
  /** Stable across refreshes: the trips it rides. */
  key: string
  departClock: string
  /** "Now" or "4 min". */
  departAway: string
  arriveClock: string
  /** Whole minutes on the clock face, departure to arrival. */
  minutes: number
  transfersText: string
  routes: RouteId[]
  source: JourneySource
  sourceText: string
  legs: LegView[]
  spoken: string
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const transfersTextOf = (n: number): string => (n === 0 ? 'No transfers' : plural(n, 'transfer'))
const walkMinutes = (durationS: number): number => Math.max(1, Math.round(durationS / 60))

function legViews(j: TripJourney, names: TripNames): LegView[] {
  const at = (stop: string, time: number): PlaceTime => {
    const stationId = stationOfStop(stop)
    return { stationId, name: names.station(stationId), clock: nyClockTime(time) }
  }
  return j.legs.map((leg, i): LegView => {
    if (leg.kind === 'ride') {
      return {
        kind: 'ride',
        routeId: leg.routeId,
        tripId: leg.tripId,
        live: leg.live === true,
        headsign: names.station(stationOfStop(leg.terminalStop)),
        board: at(leg.boardStop, leg.departAt),
        alight: at(leg.alightStop, leg.arriveAt),
        stopsText: plural(leg.stops.length - 1, 'stop'),
      }
    }
    const toStationId = stationOfStop(leg.toStop)
    const between = j.legs[i - 1]?.kind === 'ride' && j.legs[i + 1]?.kind === 'ride'
    // Platforms of one complex (same name, different station ids) are a change too: "Walk to 14 St-Union Sq" after
    // getting off at 14 St-Union Sq would read as a mistake.
    const sameName = names.station(stationOfStop(leg.fromStop)) === names.station(toStationId)
    if ((leg.sameStation || sameName) && between) {
      return { kind: 'change', stationId: toStationId, name: names.station(toStationId), minutes: leg.durationS > 0 ? walkMinutes(leg.durationS) : null }
    }
    return { kind: 'walk', toStationId, to: names.station(toStationId), minutes: walkMinutes(leg.durationS) }
  })
}

/**
 * One journey as the panel and the screen reader read it. It departs when the first train does, not when the
 * rider starts walking to it; a walk-only journey departs when it starts.
 */
export function journeyView(j: TripJourney, nowS: number, names: TripNames): JourneyView {
  const rides = j.legs.filter((l): l is TripRideLeg => l.kind === 'ride')
  const departAt = rides[0]?.departAt ?? j.departAt
  const eta = stopEta(departAt, nowS)
  const minutes = Math.floor(j.arriveAt / 60) - Math.floor(departAt / 60)
  const routes = rides.map((r) => r.routeId)
  const transfersText = transfersTextOf(j.transfers)
  const arriveClock = nyClockTime(j.arriveAt)
  const source = journeySource(j)
  const via = routes.length > 0 ? `: ${routes.map((r) => routeSpokenName(names.route(r))).join(', then ')}` : ''
  const spoken =
    `Leaves ${stopEtaSpoken(eta)}. Arrives ${arriveClock}. ${plural(minutes, 'minute')}, ${transfersText.toLowerCase()}${via}. ` +
    `${SOURCE_TEXT[source]}.`
  return {
    key: journeyKey(j),
    departClock: eta.clock,
    departAway: eta.away,
    arriveClock,
    minutes,
    transfersText,
    routes,
    source,
    sourceText: SOURCE_TEXT[source],
    legs: legViews(j, names),
    spoken,
  }
}

/** What the live region says for a settled plan: the count and the first journey, or the message. */
export function tripAnnouncement(ends: TripEnds, plan: TripPlanState, views: readonly JourneyView[]): string {
  const first = views[0]
  if (plan.status !== 'ready' || !first) return tripMessage(ends, plan, false) ?? ''
  return `${plural(views.length, 'trip')}. First arrives ${first.arriveClock}, ${plural(first.minutes, 'minute')}, ${first.transfersText.toLowerCase()}.`
}

/** Names one visitor-caused run; null while a plan is not settled. */
export function tripAnnounceId(plan: TripPlanState): string | null {
  return plan.status === 'idle' || plan.status === 'loading' ? null : `${plan.key}#${plan.attempt}`
}

/** A settled plan the visitor asked for and has not heard yet; a refresh stays silent. */
export function shouldAnnounceTrip(plan: TripPlanState, lastAnnouncedId: string | null): boolean {
  const id = tripAnnounceId(plan)
  return id !== null && id !== lastAnnouncedId && plan.status !== 'idle' && plan.status !== 'loading' && plan.trigger !== 'tick' && plan.trigger !== 'poll'
}

/** Names for the views from the map's station and route tables. */
export function tripNamesOf(network: {
  stationById: ReadonlyMap<string, { name: string }>
  routeById: ReadonlyMap<string, { shortName: string }>
}): TripNames {
  return {
    station: (id) => network.stationById.get(id)?.name ?? id,
    route: (id) => network.routeById.get(id)?.shortName ?? id,
  }
}

/** The journeys of a ready plan as views; none otherwise. */
export function planViews(plan: TripPlanState, nowS: number, names: TripNames): JourneyView[] {
  if (plan.status !== 'ready') return []
  // Two journeys with the same legs on different trains would share a key: the later ones get a suffix.
  const seen = new Map<string, number>()
  return plan.journeys.map((j) => {
    const view = journeyView(j, nowS, names)
    const n = seen.get(view.key) ?? 0
    seen.set(view.key, n + 1)
    return n === 0 ? view : { ...view, key: `${view.key}#${n}` }
  })
}

/** After a result settles, a station focused behind the panel stays unannounced this long, so it can't talk over it. */
export const ON_MAP_QUIET_MS = 1500

export interface OnMapInput {
  /** The station the camera now focuses, and the one it focused when this was last checked. */
  focusedId: string | null
  previousId: string | null
  /** The trip panel is open and nothing covers it. */
  shown: boolean
  /** The focused station is already From or To. */
  isEnd: boolean
  planLoading: boolean
  /** Milliseconds since a plan settled; null if none has. */
  sinceSettledMs: number | null
}

/**
 * Whether "On the map: X" is said: only when the focused station really changed while the panel is in front
 * (never on opening, a swap, an end pick or the cover going), it is not an end, and no result is loading or has
 * just settled.
 */
export function shouldAnnounceOnMap(i: OnMapInput): boolean {
  if (i.focusedId === null || i.focusedId === i.previousId || !i.shown || i.isEnd || i.planLoading) return false
  return i.sinceSettledMs === null || i.sinceSettledMs >= ON_MAP_QUIET_MS
}
